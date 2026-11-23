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
  LogIn,
  LogOut,
  Mail,
  Palette,
  Sparkles,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { profile as defaultProfile } from "../../lib/profile";
import { localize, THEMES, type Lang, type PortfolioProfile, type ThemeId } from "../../lib/schema";

interface AuthUser {
  email: string;
  usedToday: number;
  dailyLimit: number;
  sites: string[];
}

type ProviderMode = "hosted-deepseek" | "hosted-openai" | "byok";

const BYOK_PRESETS = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
] as const;

export function CreateStudioClient() {
  const [lang, setLang] = useState<Lang>("zh");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authChallenge, setAuthChallenge] = useState("");
  const [authStep, setAuthStep] = useState<"email" | "code">("email");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [resumeText, setResumeText] = useState("");
  const [theme, setTheme] = useState<ThemeId>("editorial");
  const [siteUrl, setSiteUrl] = useState("https://talkcv.renss.top");
  const [providerMode, setProviderMode] = useState<ProviderMode>("hosted-deepseek");
  const [byokPreset, setByokPreset] = useState<string>("deepseek");
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
  const [publishedExpires, setPublishedExpires] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((data: { user?: AuthUser | null }) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr(null);
    setAuthMsg(null);
    setAuthBusy(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: authEmail }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        delivery?: string;
        instantCode?: string;
        challenge?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to send code.");
      setAuthChallenge(data.challenge || "");
      setAuthStep("code");
      if (data.instantCode) {
        setAuthCode(data.instantCode);
        setAuthMsg(
          lang === "zh"
            ? `测试期即时验证码：${data.instantCode}（已自动填入，点击确认即可登录）`
            : `Instant verification code: ${data.instantCode} (auto-filled)`,
        );
      } else {
        setAuthMsg(
          lang === "zh"
            ? "验证码已发送到你的邮箱，请查收（10 分钟内有效）。"
            : "Verification code sent to your email (valid for 10 min).",
        );
      }
    } catch (err) {
      setAuthErr(err instanceof Error ? err.message : "Failed to send code.");
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr(null);
    setAuthBusy(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: authEmail, code: authCode, challenge: authChallenge }),
      });
      const data = (await res.json()) as { ok?: boolean; user?: AuthUser; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error || "Invalid code.");
      setUser(data.user);
      setAuthModalOpen(false);
      setAuthStep("email");
      setAuthCode("");
      setAuthMsg(null);
    } catch (err) {
      setAuthErr(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  const onByokPresetChange = (id: string) => {
    setByokPreset(id);
    const preset = BYOK_PRESETS.find((p) => p.id === id);
    if (preset) {
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
    if (providerMode !== "byok" && !user) {
      setAuthModalOpen(true);
      return;
    }
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
          providerMode,
          ...(providerMode === "byok"
            ? {
                apiKey: apiKey.trim() || undefined,
                baseUrl: baseUrl.trim() || undefined,
                model: model.trim() || undefined,
              }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        profile?: PortfolioProfile;
        quota?: { usedToday: number; dailyLimit: number };
        error?: string;
      };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Generation failed.");
      }
      setGenerated(data.profile);
      setHasGenerated(true);
      setPublishedUrl(null);
      if (data.quota && user) {
        setUser({ ...user, usedToday: data.quota.usedToday, dailyLimit: data.quota.dailyLimit });
      }
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
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
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
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        slug?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Publish failed.");
      }
      setPublishedUrl(data.url);
      setPublishedExpires(data.expiresAt ? data.expiresAt.slice(0, 10) : null);
      if (data.slug && !user.sites.includes(data.slug)) {
        setUser({ ...user, sites: [...user.sites, data.slug] });
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  const remaining = user ? Math.max(0, user.dailyLimit - user.usedToday) : 3;

  return (
    <main className="af-create-page" data-theme={theme}>
      <header className="af-header">
        <Link className="af-brand" href="/">
          <span className="af-brand-mark">TC</span>
          <strong>TalkCV Studio</strong>
        </Link>
        <div className="af-header-controls">
          {user ? (
            <div className="af-user-pill">
              <User size={13} />
              <span>{user.email}</span>
              <em>
                {lang === "zh" ? `今日剩 ${remaining}/${user.dailyLimit} 次` : `${remaining}/${user.dailyLimit} left`}
              </em>
              <button type="button" onClick={logout} title={lang === "zh" ? "退出登录" : "Sign out"}>
                <LogOut size={12} />
              </button>
            </div>
          ) : (
            <button type="button" className="af-icon-pill af-login-pill" onClick={() => setAuthModalOpen(true)}>
              <LogIn size={13} />
              <span>{lang === "zh" ? "邮箱登录（领每日免费额度）" : "Sign in with Email"}</span>
            </button>
          )}
          <Link className="af-icon-pill" href="/">
            <ArrowLeft size={13} />
            <span>{lang === "zh" ? "示例站" : "Demo"}</span>
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
              ? "邮箱登录后即可免 Key 免费生成（每日 3 次，默认 DeepSeek 国内直连免 VPN），并免费托管 30 天专属链接。"
              : "Sign in with email for 3 free daily generations (DeepSeek / OpenAI hosted) and 30-day free hosting."}
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
            rows={7}
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
              <KeyRound size={13} /> {lang === "zh" ? "3. 选择 AI 通道" : "3. Choose AI provider"}
            </span>
          </div>
          <div className="af-preset-row">
            <button
              type="button"
              className={providerMode === "hosted-deepseek" ? "active" : ""}
              onClick={() => setProviderMode("hosted-deepseek")}
            >
              {lang === "zh" ? "DeepSeek 免费托管（国内直连）" : "Hosted DeepSeek (Free)"}
            </button>
            <button
              type="button"
              className={providerMode === "hosted-openai" ? "active" : ""}
              onClick={() => setProviderMode("hosted-openai")}
            >
              {lang === "zh" ? "OpenAI 免费托管" : "Hosted OpenAI (Free)"}
            </button>
            <button
              type="button"
              className={providerMode === "byok" ? "active" : ""}
              onClick={() => setProviderMode("byok")}
            >
              {lang === "zh" ? "自带 API Key（不限次）" : "Bring Your Own Key"}
            </button>
          </div>

          {providerMode === "byok" ? (
            <>
              <div className="af-preset-row">
                {BYOK_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={byokPreset === p.id ? "active" : ""}
                    onClick={() => onByokPresetChange(p.id)}
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
                  placeholder="Base URL"
                />
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="Planned Site URL"
                />
              </div>
            </>
          ) : (
            <div className="af-quota-note">
              {user ? (
                <span>
                  {lang === "zh"
                    ? `已登录 ${user.email} · 今日剩余免费生成 ${remaining}/${user.dailyLimit} 次（无需填写 API Key）`
                    : `Signed in as ${user.email} · ${remaining}/${user.dailyLimit} free generations left today`}
                </span>
              ) : (
                <button type="button" className="af-inline-link" onClick={() => setAuthModalOpen(true)}>
                  {lang === "zh"
                    ? "👉 点击先用邮箱登录，立即解锁免 Key 免费生成（每日 3 次）"
                    : "👉 Sign in with email to unlock 3 free daily generations (no API key needed)"}
                </button>
              )}
            </div>
          )}

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
                      ? "一键免费托管（30天）"
                      : "Publish Free (30 days)"}
                </span>
              </button>
            </div>
            {publishError && <div className="af-ai-error">{publishError}</div>}
            {publishedUrl && (
              <div className="af-published-banner">
                <div>
                  <a href={publishedUrl} target="_blank" rel="noreferrer">
                    🎉 {publishedUrl}
                    <ExternalLink size={13} />
                  </a>
                  {publishedExpires && (
                    <small className="af-expiry-note">
                      {lang === "zh" ? `免费托管有效期至 ${publishedExpires}` : `Free hosting until ${publishedExpires}`}
                    </small>
                  )}
                </div>
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

      {authModalOpen && (
        <div className="af-cmd-backdrop" role="dialog" aria-modal="true" onClick={() => setAuthModalOpen(false)}>
          <div className="af-auth-modal" onClick={(e) => e.stopPropagation()}>
            <div className="af-auth-head">
              <strong>
                <Mail size={15} /> {lang === "zh" ? "邮箱验证码登录" : "Sign in with Email"}
              </strong>
              <button type="button" onClick={() => setAuthModalOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            {authStep === "email" ? (
              <form className="af-auth-form" onSubmit={sendOtp}>
                <p>
                  {lang === "zh"
                    ? "登录后即可免费使用 TalkCV 内置 DeepSeek / OpenAI 额度（每日 3 次）并免费托管你的专属简历链接。"
                    : "Sign in to unlock 3 free daily AI generations and 30-day hosting for your TalkCV link."}
                </p>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                {authErr && <div className="af-ai-error">{authErr}</div>}
                <button type="submit" className="af-btn af-btn-primary" disabled={authBusy}>
                  {authBusy ? (lang === "zh" ? "发送中…" : "Sending…") : lang === "zh" ? "获取 6 位验证码" : "Send 6-digit code"}
                </button>
              </form>
            ) : (
              <form className="af-auth-form" onSubmit={verifyOtp}>
                {authMsg && <div className="af-quota-note">{authMsg}</div>}
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder={lang === "zh" ? "输入 6 位验证码" : "6-digit code"}
                />
                {authErr && <div className="af-ai-error">{authErr}</div>}
                <button type="submit" className="af-btn af-btn-primary" disabled={authBusy}>
                  {authBusy ? (lang === "zh" ? "验证中…" : "Verifying…") : lang === "zh" ? "确认登录" : "Verify & Sign in"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
