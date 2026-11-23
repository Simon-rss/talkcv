"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Globe,
  KeyRound,
  Palette,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { profile as defaultProfile } from "../../lib/profile";
import { localize, THEMES, type Lang, type PortfolioProfile, type ThemeId } from "../../lib/schema";

const PROVIDER_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "deepseek", label: "DeepSeek (国内直连)", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { id: "custom", label: "Custom", baseUrl: "", model: "" },
] as const;

export function CreateStudioClient() {
  const [lang, setLang] = useState<Lang>("zh");
  const [resumeText, setResumeText] = useState("");
  const [theme, setTheme] = useState<ThemeId>("editorial");
  const [siteUrl, setSiteUrl] = useState("https://my-talkcv.dev");
  const [provider, setProvider] = useState<string>("deepseek");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<PortfolioProfile>(defaultProfile);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handle, setHandle] = useState("alex-chen");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const onProviderChange = (id: string) => {
    setProvider(id);
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (preset && preset.id !== "custom") {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setResumeText(text.slice(0, 14000));
  };

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resumeText,
          theme,
          siteUrl,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { profile?: PortfolioProfile; error?: string };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Generation failed.");
      }
      setGenerated(data.profile);
      setHasGenerated(true);
      setPublishedUrl(null);
      const suggested = data.profile.basics.name.en
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      if (suggested.length >= 3) setHandle(suggested);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate profile.");
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    const blob = new Blob([`${JSON.stringify({ ...generated, theme }, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "profile.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(`${JSON.stringify({ ...generated, theme }, null, 2)}\n`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const openFullscreenPreview = () => {
    window.sessionStorage.setItem(
      "talkcv-draft-profile",
      JSON.stringify({ ...generated, theme }),
    );
    window.open("/preview", "_blank", "noopener,noreferrer");
  };

  const publishLiveSite = async () => {
    setPublishError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: handle,
          profile: { ...generated, theme },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Publish failed.");
      }
      setPublishedUrl(data.url);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <main className="af-create-page" data-theme={theme}>
      <header className="af-header">
        <Link className="af-brand" href="/">
          <span className="af-brand-mark">TC</span>
          <strong>TalkCV Studio</strong>
        </Link>
        <div className="af-header-controls">
          <Link className="af-icon-pill" href="/">
            <ArrowLeft size={13} />
            <span>{lang === "zh" ? "返回示例站" : "Back to Demo"}</span>
          </Link>
          <button
            type="button"
            className="af-icon-pill"
            onClick={() => setLang(lang === "en" ? "zh" : "en")}
          >
            {lang === "en" ? "中" : "EN"}
          </button>
        </div>
      </header>

      <div className="af-shell af-create-grid">
        <form className="af-create-panel" onSubmit={onGenerate}>
          <p className="af-eyebrow">TALKCV GENERATOR</p>
          <h1>{lang === "zh" ? "把简历变成会说话的网站" : "Turn your resume into a site that talks back"}</h1>
          <p className="af-create-sub">
            {lang === "zh"
              ? "粘贴简历文本或上传 .md / .txt 文件，填入你的 API Key（仅本次请求使用，绝不存储），10 秒生成双语配置并实时预览 3 套主题。"
              : "Paste your resume or upload .md/.txt, bring your own API key (never stored), and preview 3 live themes in seconds."}
          </p>

          <label className="af-field-label">
            <span>{lang === "zh" ? "1. 简历内容" : "1. Resume content"}</span>
            <label className="af-upload-btn">
              <FileUp size={13} />
              <span>{lang === "zh" ? "导入 .md / .txt" : "Upload .md / .txt"}</span>
              <input type="file" accept=".md,.txt,.json" onChange={onFileUpload} hidden />
            </label>
          </label>
          <textarea
            className="af-textarea"
            rows={8}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder={
              lang === "zh"
                ? "把你的简历全文（姓名、联系方式、工作经历、项目成果、技能）直接粘贴在这里…"
                : "Paste your resume text (name, contact, experience, projects, metrics, skills)…"
            }
            required
          />

          <div className="af-field-label">
            <span>
              <Palette size={13} /> {lang === "zh" ? "2. 选择默认主题" : "2. Choose theme"}
            </span>
          </div>
          <div className="af-preset-row">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={theme === t.id ? "active" : ""}
                onClick={() => setTheme(t.id)}
              >
                {localize(t.label, lang)}
              </button>
            ))}
          </div>

          <div className="af-field-label">
            <span>
              <KeyRound size={13} /> {lang === "zh" ? "3. 模型与 API Key（BYOK，不落盘）" : "3. Model & API Key (BYOK, never stored)"}
            </span>
          </div>
          <div className="af-preset-row">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={provider === p.id ? "active" : ""}
                onClick={() => onProviderChange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="af-input-grid">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key (sk-...)"
              autoComplete="off"
            />
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model (e.g. deepseek-chat)"
            />
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL (https://api.deepseek.com/v1)"
            />
            <input
              type="url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="Planned Site URL (https://me.dev)"
            />
          </div>

          {error && <div className="af-ai-error">{error}</div>}

          <button type="submit" className="af-btn af-btn-primary af-create-submit" disabled={loading}>
            <Sparkles size={16} />
            <span>
              {loading
                ? lang === "zh"
                  ? "正在解析简历并生成双语站…"
                  : "Generating your TalkCV…"
                : lang === "zh"
                  ? "免费生成 TalkCV 配置"
                  : "Generate TalkCV Profile"}
            </span>
          </button>
        </form>

        <section className="af-preview-panel" data-theme={theme}>
          <div className="af-preview-bar">
            <span>
              {hasGenerated
                ? lang === "zh"
                  ? "✅ 已生成你的实时预览"
                  : "✅ Generated live preview"
                : lang === "zh"
                  ? "示例实时预览（生成后自动替换）"
                  : "Sample live preview"}
            </span>
            <div className="af-preview-actions">
              <button type="button" className="af-icon-pill" onClick={openFullscreenPreview}>
                <ExternalLink size={13} />
                <span>{lang === "zh" ? "全屏体验" : "Fullscreen"}</span>
              </button>
              <button type="button" className="af-icon-pill" onClick={copyJson}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? (lang === "zh" ? "已复制" : "Copied") : "JSON"}</span>
              </button>
              <button type="button" className="af-icon-pill" onClick={downloadJson}>
                <Download size={13} />
                <span>{lang === "zh" ? "下载" : "Download"}</span>
              </button>
            </div>
          </div>

          <div className="af-publish-box">
            <div className="af-publish-row">
              <div className="af-handle-input">
                <span>/u/</span>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="your-name"
                  aria-label="Custom handle"
                />
              </div>
              <button
                type="button"
                className="af-btn af-btn-primary af-publish-btn"
                disabled={publishing}
                onClick={publishLiveSite}
              >
                <Globe size={15} />
                <span>
                  {publishing
                    ? lang === "zh"
                      ? "发布中…"
                      : "Publishing…"
                    : lang === "zh"
                      ? "一键发布专属链接"
                      : "Publish Live Link"}
                </span>
              </button>
            </div>
            {publishError && <div className="af-ai-error">{publishError}</div>}
            {publishedUrl && (
              <div className="af-published-banner">
                <a href={publishedUrl} target="_blank" rel="noreferrer">
                  🎉 {publishedUrl}
                  <ExternalLink size={13} />
                </a>
                <button
                  type="button"
                  className="af-icon-pill"
                  onClick={() => {
                    void navigator.clipboard?.writeText(publishedUrl);
                    setCopiedUrl(true);
                    window.setTimeout(() => setCopiedUrl(false), 1800);
                  }}
                >
                  {copiedUrl ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedUrl ? (lang === "zh" ? "已复制" : "Copied") : lang === "zh" ? "复制链接" : "Copy Link"}</span>
                </button>
              </div>
            )}
          </div>

          <div className="af-preview-canvas">
            <p className="af-role">{localize(generated.basics.role, lang)}</p>
            <h2>{localize(generated.basics.name, lang)}</h2>
            <p className="af-preview-headline">{localize(generated.basics.headline, lang)}</p>
            <p className="af-card-summary">{localize(generated.basics.intro, lang)}</p>

            <div className="af-skill-strip">
              {generated.skills.slice(0, 8).map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>

            <div className="af-preview-projects">
              {generated.projects.slice(0, 3).map((proj) => (
                <article key={proj.slug} className="af-card">
                  <span className="af-card-cat">{localize(proj.category, lang)}</span>
                  <h3>{localize(proj.title, lang)}</h3>
                  <p className="af-card-summary">{localize(proj.summary, lang)}</p>
                  <div className="af-facts">
                    {proj.facts.slice(0, 3).map((f) => (
                      <div key={f.value + f.label.en}>
                        <strong>{f.value}</strong>
                        <span>{localize(f.label, lang)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
