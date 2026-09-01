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

function getOutputText(response: any): string {
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text") return part.text;
    }
  }
  throw new Error("OpenAI response did not contain output_text");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");

    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) throw new Error("Invalid user session");

    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 20);
    const { data: items, error: listError } = await client
      .from("learning_items")
      .select("id,title,author,raw_content,source_url")
      .in("processing_status", ["pending", "failed"])
      .order("created_at", { ascending: true })
      .limit(limit);
    if (listError) throw listError;

    let processed = 0;
    let failed = 0;
    for (const item of items || []) {
      await client.from("learning_items").update({ processing_status: "processing" }).eq("id", item.id);
      try {
        const sourceMaterial = [
          `标题：${item.title || "未知"}`,
          `作者：${item.author || "未知"}`,
          `页面可见内容：${item.raw_content || "未采集到正文，仅可根据标题判断"}`,
          `来源链接：${item.source_url}`,
        ].join("\n");
        const aiResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-5.4-mini",
            store: false,
            reasoning: { effort: "low" },
            instructions: "你是个人学习知识管理助手。根据用户已合法采集的页面可见信息生成忠实摘要与三级标签。材料不足时明确写出信息有限，不得虚构正文、观点或结论。",
            input: sourceMaterial,
            text: { format: { type: "json_schema", name: "learning_item_analysis", strict: true, schema: analysisSchema } },
          }),
        });
        if (!aiResponse.ok) throw new Error(`OpenAI ${aiResponse.status}: ${await aiResponse.text()}`);
        const analysis = JSON.parse(getOutputText(await aiResponse.json()));
        const { error: updateError } = await client.from("learning_items").update({
          summary: analysis.summary,
          category: analysis.category,
          subcategory: analysis.subcategory,
          content_type: analysis.content_type,
          processing_status: "completed",
          processed_at: new Date().toISOString(),
        }).eq("id", item.id);
        if (updateError) throw updateError;
        processed++;
      } catch (error) {
        console.error("Failed to process", item.id, error);
        await client.from("learning_items").update({ processing_status: "failed" }).eq("id", item.id);
        failed++;
      }
    }
    return new Response(JSON.stringify({ processed, failed, total: (items || []).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
