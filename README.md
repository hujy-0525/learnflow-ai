# LearnFlow AI

一个面向跨平台收藏场景的 AI 学习管理平台高保真前端原型。

## 运行

直接用浏览器打开 `index.html`，或在本目录启动任意静态文件服务器。

```powershell
python -m http.server 8080
```

随后访问 `http://localhost:8080`。

## 核心体验

- 小红书、B站、公众号、网页的统一收藏入口
- AI 自动总结与三级语义标签体系
- 智能收件箱、跨平台筛选及全文搜索
- 可缩放的知识关系图谱
- 从收藏内容自动生成学习场景与执行路径
- 桌面端与移动端响应式布局

## Chrome 扩展（小红书）

`chrome-extension/` 提供 Manifest V3 扩展，可扫描小红书网页版收藏夹中当前已加载的笔记，并通过已登录的 LearnFlow 页面批量写入 Supabase。

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目的 `chrome-extension` 文件夹
5. 登录小红书网页版并打开收藏夹，滚动加载内容后点击扩展同步

## AI 处理流水线

`supabase/functions/process-learning-items` 是服务端 Edge Function：使用当前用户 JWT 读取其待处理收藏，调用 DeepSeek API 生成摘要与「大类—细分领域—内容类型」标签，再将状态更新为 `completed`。

部署前需要在 Supabase Edge Function Secrets 中设置 `DEEPSEEK_API_KEY`，密钥不得提交到仓库或放入浏览器代码。
