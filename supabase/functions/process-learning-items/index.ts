import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "100至180字中文摘要，只陈述输入材料支持的信息" },
    category: { type: "string", enum: ["AI 产品设计", "AI 技术基础", "数据分析", "用户体验", "职业成长", "个人成长", "其他"] },
    subcategory: { type: "string", description: "具体细分领域，2至12个汉字" },
    content_type: { type: "string", enum: ["案例拆解", "方法论", "视频教程", "技术文章", "行业报告", "工具推荐", "观点讨论", "其他"] },
  },
  required: ["summary", "category", "subcategory", "content_type"],
};

const categoryOptions = analysisSchema.properties.category.enum;
const contentTypeOptions = analysisSchema.properties.content_type.enum;

function parseAnalysis(response: any) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek response did not contain message content");
  }
  const result = JSON.parse(content);
  if (typeof result.summary !== "string" || !result.summary.trim()) {
    throw new Error("DeepSeek response is missing summary");
  }
  return {
    summary: result.summary.trim(),
    category: categoryOptions.includes(result.category) ? result.category : "其他",
    subcategory: typeof result.subcategory === "string" && result.subcategory.trim()
      ? result.subcategory.trim().slice(0, 24)
      : "待进一步整理",
    content_type: contentTypeOptions.includes(result.content_type) ? result.content_type : "其他",
  };
}

function splitCapturedContent(rawContent: string | null) {
  const [text = "", imagePart = ""] = (rawContent || "").split("[LEARNFLOW_IMAGE_URLS]", 2);
  const imageUrls = imagePart.split(/\r?\n/).map((value) => value.trim())
    .filter((value) => /^https?:\/\//i.test(value)).slice(0, 9);
  return { text: text.trim(), imageUrls };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function downloadImage(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "Referer": "https://www.xiaohongshu.com/",
        "User-Agent": "Mozilla/5.0 LearnFlow/1.0",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const mime = (response.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(mime)) return null;
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 3_000_000) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 3_000_000) return null;
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  } catch (error) {
    console.warn("Could not download image", url, error);
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    if (!deepseekKey) throw new Error("DEEPSEEK_API_KEY is not configured");

    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) throw new Error("Invalid user session");

    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 20);
    const { data: items, error: listError } = await client
      .from("learning_items")
      .select("id,title,author,raw_content,cover_url,source_url")
      .in("processing_status", ["pending", "failed", "processing"])
      .order("created_at", { ascending: true })
      .limit(limit);
    if (listError) throw listError;

    const results = [];
    const queue = items || [];
    for (let offset = 0; offset < queue.length; offset += 4) {
      const batchResults = await Promise.all(queue.slice(offset, offset + 4).map(async (item) => {
      await client.from("learning_items").update({ processing_status: "processing" }).eq("id", item.id);
      try {
        const captured = splitCapturedContent(item.raw_content);
        const imageUrls = [...new Set([item.cover_url, ...captured.imageUrls].filter(Boolean))].slice(0, 6);
        const downloadedImages = (await Promise.all(imageUrls.map(downloadImage))).filter(Boolean);
        const sourceMaterial = [
          `标题：${item.title || "未知"}`,
          `作者：${item.author || "未知"}`,
          `页面可见正文：${captured.text || "未采集到正文，请结合图片中的公开信息判断"}`,
          `来源链接：${item.source_url}`,
        ].join("\n");
        const userContent = downloadedImages.length ? [
          { type: "text", text: `${sourceMaterial}\n\n请阅读所附图片中的文字和画面信息，并与正文合并分析。` },
          ...downloadedImages.map((url) => ({ type: "image_url", image_url: { url, detail: "original" } })),
        ] : sourceMaterial;
        const aiResponse = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${deepseekKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: downloadedImages.length ? "deepseek-v4-flash-vision-exp" : "deepseek-v4-flash",
            thinking: { type: "disabled" },
            messages: [
              {
                role: "system",
                content: `你是个人学习知识管理助手。根据用户已合法采集的页面可见信息生成忠实摘要与三级标签。材料不足时明确写出信息有限，不得虚构正文、观点或结论。只输出一个 JSON 对象，字段必须为 summary、category、subcategory、content_type。category 只能从 ${categoryOptions.join("、")} 中选择；content_type 只能从 ${contentTypeOptions.join("、")} 中选择。`,
              },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(downloadedImages.length ? 45_000 : 20_000),
        });
        if (!aiResponse.ok) throw new Error(`DeepSeek ${aiResponse.status}: ${await aiResponse.text()}`);
        const analysis = parseAnalysis(await aiResponse.json());
        const { error: updateError } = await client.from("learning_items").update({
          summary: analysis.summary,
          category: analysis.category,
          subcategory: analysis.subcategory,
          content_type: analysis.content_type,
          processing_status: "completed",
          processed_at: new Date().toISOString(),
        }).eq("id", item.id);
        if (updateError) throw updateError;
        return { id: item.id, ok: true, imagesCaptured: imageUrls.length, imagesRead: downloadedImages.length };
      } catch (error) {
        console.error("Failed to process", item.id, error);
        await client.from("learning_items").update({ processing_status: "failed" }).eq("id", item.id);
        return {
          id: item.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      }));
      results.push(...batchResults);
    }
    const processed = results.filter((result) => result.ok).length;
    const failed = results.length - processed;
    return new Response(JSON.stringify({ processed, failed, total: (items || []).length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
