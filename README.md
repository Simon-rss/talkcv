# TalkCV — AI-Native Interactive Résumé & Portfolio Engine

> **30 秒把你的 PDF / Word / 截图简历，变成一个会跟 HR 对话的 AI 个人官网。**
> **Turn any PDF, DOCX, or résumé screenshot into a bilingual interactive AI website in 30 seconds.**

🌐 **Live Hosted Service / 在线即刻体验**: [https://mytalkcv.com](https://mytalkcv.com)
📧 **Contact / 商务与反馈**: [hi@mytalkcv.com](mailto:hi@mytalkcv.com)

---

## ✨ Core Highlights / 核心亮点

- **Multi-Format Résumé Parsing / 多格式无损解析**：支持 PDF、Word（`.docx`）、Markdown 与简历截图 OCR 解析，严格保留原始量化指标与事实。
- **Dual Render Engine / 双渲染引擎**：
  - **Structured Deep Skins（结构化深度皮肤）**：内置 Apple 官网发布会风、瑞士极简杂志风、复古 Win95 桌面风、黑金建筑画册风等 6+ 预设皮肤，支持所见即所得点击即改。
  - **Custom AI Web Mode（自由创意网页模式）**：AI 按你的风格提示词生成沙箱安全、移动端自适应的独一无二单页 HTML+CSS 作品集。
- **Cited Visitor AI Q&A & JD Matching / 可验证引用 AI 问答与 JD 匹配**：访客（HR / CTO / 创始人视角）可划选正文追问或粘贴岗位 JD 测匹配度，AI 回复自动附带可点击引用锚点，并严格遵守作者专属私密 `aiBrief` 回答边界。
- **Lossless QR Stamp on Original PDF / 原版 PDF 无损盖「扫码问 AI」印章**：保留你原有的求职 PDF 排版，浏览器本地无损在首页盖上一枚可点击二维码徽章（同时支持内置高密度 A4 PDF 导出与分享海报）。
- **Privacy & Recruiter Lead Capture / 隐私可控与约面留资闭环**：支持口令访问保护、`noindex` 防收录、本地手机号/邮箱一键打码，以及静态简历永久在线 + 招聘方一键留资约面邮件通知。
- **Multi-Model Routing / 多模型托管与 BYOK**：原生支持 DeepSeek、OpenAI（GPT-4o / o3 / GPT-5/6）与 Google Gemini（Gemini 3.5 / 3.8 / 4），也支持用户自带 API Key（BYOK）。

---

## 🚀 Two Deployment Modes / 两种部署架构

### Mode A: Zero-DB Personal Edition（零数据库极简个人版）

适合开发者自建个人交互式简历主页，只需维护一份 `data/profile.json`，零数据库依赖，一键部署到 Cloudflare Workers 或任意 Node 环境：

```bash
git clone https://github.com/Simon-rss/talkcv.git
cd talkcv
npm install
npm run validate   # 校验 data/profile.json
npm run dev        # 本地预览 http://localhost:5173
```

部署到 Cloudflare Workers：
```bash
npm run build
npx wrangler deploy
```

### Mode B: Full-Stack Multi-Tenant SaaS（全栈自托管多租户版，同 `mytalkcv.com` 生产架构）

适合团队或自建多用户平台，使用 **Docker Compose + Node.js (`server/node-entry.mjs`) + PostgreSQL (`talkcv_store` / `talkcv_sites`) + Resend 邮件验证码 + Creem 支付**：

```bash
cp .env.example .env
# 在 .env 中填入 DATABASE_URL / AUTH_SECRET / RESEND_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / CREEM_* 等环境变量
docker compose up -d --build
```

生产架构特性：
- **PostgreSQL 强一致存储**：替代最终一致 KV，通过 advisory lock 保证多实例站点名额与积分扣减原子性；
- **媒体分离存储**：大体积 Base64 头像与封面图自动拆离至 `profile_media:<slug>`，AI 聊天与 OG 卡片生成免读大图；
- **动态 PNG OpenGraph (`/api/og`)**：服务端 `@resvg/resvg-js` 实时栅格化输出 `1200×630` `image/png` 社交预览卡片；
- **内置运营后台 (`/admin`)**：实时全站 PV/UV、来源渠道、设备分布、用户/站点/积分与兑换码/打折券管理。

---

## 🧪 Verification / 本地校验

```bash
npm run validate
npx tsc --noEmit
npm run lint
npm test
```

---

## 📄 License / 开源协议

TalkCV 采用**非商用源码开放授权**（详见 [LICENSE](./LICENSE)）：
- ✅ 个人求职使用、学习研究与个人主页自托管完全免费；
- ❌ 未经作者书面授权，禁止用于商业 SaaS 转售或竞品二次包装。

如需商业授权、企业定制或合作联系，请发邮件至 **hi@mytalkcv.com**。
