# TalkCV

> **A resume website that talks back.** Drop your resume + API key, pick a theme, and ship a zero-database, bilingual, Agent-native portfolio on Cloudflare Workers in minutes.

## Why TalkCV?

Most open-source "resume-to-portfolio" tools either output static dead HTML or require setting up Postgres/MongoDB/Supabase just to host a personal site.

**TalkCV** is driven by **one single JSON file (`data/profile.json`)** and ships with:

- **1-Command CLI & Online `/create` Studio**: Parse `.md`, `.txt`, `.docx`, or `.pdf` resumes via `npm run generate` OR use the built-in `/create` web studio (bring your own OpenAI / DeepSeek / OpenRouter key, preview 3 live themes, export `profile.json`).
- **3 Built-in Switchable Themes**:
  - `editorial` — Warm ivory paper, crisp ink, emerald accents
  - `terminal` — Obsidian dark mode, phosphor green, monospace craft
  - `bento` — Modern rounded Bento card grid with vivid indigo-blue accents
- **Built-in AI Agent with Live UI Tool Calling**: Recruiters can chat with your resume, paste a **Job Description (JD)** for an honest match report, highlight any text to ask AI, or let the agent navigate projects, switch themes, and draft interview emails.
- **Machine-Readable Endpoints Out of the Box**: Auto-generated `/llms.txt`, `/resume.json` (JSON Resume schema), `/sitemap.xml`, `/robots.txt`, and JSON-LD — all derived from `data/profile.json`.
- **Developer Polish**: `⌘K` command palette, deep links (`?ask=`, `?jd=`, `?theme=`, `?filter=`), `←`/`→` case navigation, reading progress bar, custom 404 easter egg, DevTools `hire()` command, `prefers-reduced-motion`, and `⌘P` A4 print-ready resume.
- **Zero Database**: Runs on Cloudflare Workers free tier (and works gracefully even without an API key).

## Quick Start

Requires Node.js `>= 22.13.0`.

```bash
git clone https://github.com/Simon-rss/talkcv.git
cd talkcv
npm install
```

### 1. Preview the demo site & 3 themes locally

```bash
npm run dev
```

Open `http://localhost:3000` and click **Editorial / Terminal / Bento** in the header (or press `⌘K`) to preview all 3 themes live.

### 2. Generate from your own resume

Copy `.env.example` to `.env` and add your OpenAI-compatible key (OpenAI, DeepSeek, OpenRouter, etc.):

```bash
cp .env.example .env
npm run generate
```

Or run non-interactively with flags:

```bash
npm run generate -- --resume ./my-resume.md --theme terminal --site https://myportfolio.dev
```

### 3. Validate & test

```bash
npm run validate
npm run lint
npm test
```

## Deploy to Cloudflare Workers

1. Push your repository to GitHub.
2. Create a Cloudflare Worker connected to your repo with build command `npm run build`.
3. Add environment variables in Cloudflare Dashboard (optional — omit to run in static no-AI mode):
   - `OPENAI_API_KEY`
   - `OPENAI_BASE_URL` (e.g. `https://api.openai.com/v1` or `https://api.deepseek.com/v1`)
   - `OPENAI_MODEL` (e.g. `gpt-4o-mini` or `deepseek-chat`)

## 中文简介

**TalkCV（会说话的简历）** 是一个零数据库、开源的 **AI 原生个人简历与作品集生成器**：放入你的简历（`.md` / `.txt` / `.docx` / `.pdf`）和任意 OpenAI 兼容 API Key（支持 OpenAI / DeepSeek / OpenRouter 等），运行 `npm run generate` 即可生成中英双语的 `data/profile.json`，内置 **Editorial / Terminal / Bento** 三套可实时切换的主题、自带工具调用与 JD 匹配的 AI 助手、`/llms.txt`、`/resume.json` 与 `⌘P` A4 打印简历。

## License

**TalkCV Noncommercial Source-Available License** — see [LICENSE](./LICENSE).

- **Personal & noncommercial use**: Free to self-host and customize for your own personal résumé/portfolio.
- **Commercial use / hosted SaaS**: Strictly prohibited without prior written authorization. Contact `rss1549596771@163.com` for commercial licensing.
