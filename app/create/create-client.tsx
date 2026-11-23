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
  Lock,
  LogIn,
  LogOut,
  Mail,
  Palette,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HOSTED_MODELS } from "../../lib/models";
import { profile as defaultProfile } from "../../lib/profile";
import { localize, THEMES, type Lang, type PortfolioProfile, type ThemeId } from "../../lib/schema";

interface AuthUser {
  email: string;
  usedToday: number;
  dailyLimit: number;
  sites: string[];
}

interface ChatMeta {
  mode: "hosted" | "byok";
  hostedModelId: string;
  hasByokKey: boolean;
  byokKeyMask: string;
  byokBaseUrl: string;
  byokModel: string;
}

const STYLE_PRESETS = [
  {
    id: "exec",
    label: { en: "Global Tech Exec", zh: "外企技术总监风" },
    prompt: "Crisp, executive engineering tone for global tech recruiters; deep slate blue accent (#1d4ed8), sharp metrics first.",
  },
  {
    id: "hacker",
    label: { en: "Hardcore Systems", zh: "极客硬核风" },
    prompt: "Direct, no-fluff systems engineer voice focused on latency, locks, and reliability; neon emerald accent (#10b981).",
  },
  {
    id: "editorial",
    label: { en: "Warm Editorial", zh: "温润文艺杂志风" },
    prompt: "Thoughtful, storytelling editorial tone highlighting product craft and user empathy; warm terracotta accent (#c2410c).",
  },
  {
    id: "ocean",
    label: { en: "Deep Ocean Tech", zh: "深海蓝科技感" },
    prompt: "Modern AI product builder tone, structured and confident; deep ocean cyan accent (#0284c7), smooth 18px corners.",
  },
] as const;

const BYOK_PRESETS = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
] as const;

const STUDIO_DRAFT_KEY = "talkcv-studio-draft";

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

  // Generation section state
  const [resumeText, setResumeText] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [theme, setTheme] = useState<ThemeId>("editorial");
  const [siteUrl, setSiteUrl] = useState("https://talkcv.renss.top");
  const [genMode, setGenMode] = useState<"hosted" | "byok">("hosted");
  const [genModelId, setGenModelId] = useState<string>("deepseek-chat");
  const [genByokPreset, setGenByokPreset] = useState<string>("deepseek");
  const [genBaseUrl, setGenBaseUrl] = useState("https://api.deepseek.com/v1");
  const [genModel, setGenModel] = useState("deepseek-chat");
  const [genApiKey, setGenApiKey] = useState("");

  // Generated profile & draft persistence
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<PortfolioProfile>(defaultProfile);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [copied, setCopied] = useState(false);

  // Visitor AI Chat config (independent from generation model!)
  const [chatMode, setChatMode] = useState<"hosted" | "byok">("hosted");
  const [chatHostedModelId, setChatHostedModelId] = useState<string>("auto");
  const [chatByokBaseUrl, setChatByokBaseUrl] = useState("https://api.openai.com/v1");
  const [chatByokModel, setChatByokModel] = useState("gpt-4o-mini");
  const [chatByokApiKey, setChatByokApiKey] = useState("");
  const [savedByokMask, setSavedByokMask] = useState("");
  const [clearByokKey, setClearByokKey] = useState(false);

  // Publishing state
  const [handle, setHandle] = useState("alex-chen");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishedExpires, setPublishedExpires] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [loadingSiteSlug, setLoadingSiteSlug] = useState<string | null>(null);

  // Restore user session
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((data: { user?: AuthUser | null }) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  // Restore saved Studio draft on mount (fixes refresh losing draft!)
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(STUDIO_DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as {
            resumeText?: string;
            stylePrompt?: string;
            theme?: ThemeId;
            handle?: string;
            generated?: PortfolioProfile;
            hasGenerated?: boolean;
          };
          if (typeof d.resumeText === "string") setResumeText(d.resumeText);
          if (typeof d.stylePrompt === "string") setStylePrompt(d.stylePrompt);
          if (d.theme === "editorial" || d.theme === "terminal" || d.theme === "bento") setTheme(d.theme);
          if (typeof d.handle === "string" && d.handle) setHandle(d.handle);
          if (d.generated && d.hasGenerated) {
            setGenerated(d.generated);
            setHasGenerated(true);
          }
        }
      } catch {
        // ignore corrupted draft
      } finally {
        setDraftHydrated(true);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // Persist Studio draft whenever key fields change
  useEffect(() => {
    if (!draftHydrated) return;
    try {
      window.localStorage.setItem(
        STUDIO_DRAFT_KEY,
        JSON.stringify({ resumeText, stylePrompt, theme, handle, generated, hasGenerated }),
      );
      if (hasGenerated) {
        window.localStorage.setItem("talkcv-draft-profile", JSON.stringify({ ...generated, theme }));
      }
    } catch {
      // ignore storage quota
    }
  }, [draftHydrated, resumeText, stylePrompt, theme, handle, generated, hasGenerated]);

  const resetDraft = () => {
    setResumeText("");
    setStylePrompt("");
    setGenerated(defaultProfile);
    setHasGenerated(false);
    setHandle("alex-chen");
    setPublishedUrl(null);
    setSavedByokMask("");
    setChatByokApiKey("");
    setClearByokKey(false);
    try {
      window.localStorage.removeItem(STUDIO_DRAFT_KEY);
      window.localStorage.removeItem("talkcv-draft-profile");
    } catch {
      // ignore
    }
  };

  const loadExistingSite = async (slug: string) => {
    setLoadingSiteSlug(slug);
    setPublishError(null);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(slug)}`);
      const data = (await res.json()) as {
        profile?: PortfolioProfile;
        expiresAt?: string;
        chatMeta?: ChatMeta;
        error?: string;
      };
      if (!res.ok || !data.profile) throw new Error(data.error || "Could not load site.");
      setGenerated(data.profile);
      setHasGenerated(true);
      setTheme(data.profile.theme || "editorial");
      setStylePrompt(data.profile.stylePrompt || data.profile.ai?.stylePrompt || "");
      setHandle(slug);
      setPublishedUrl(`${window.location.origin}/u/${slug}`);
      setPublishedExpires(data.expiresAt ? data.expiresAt.slice(0, 10) : null);
      if (data.chatMeta) {
        setChatMode(data.chatMeta.mode);
        setChatHostedModelId(data.chatMeta.hostedModelId || "auto");
        setSavedByokMask(data.chatMeta.hasByokKey ? data.chatMeta.byokKeyMask : "");
        if (data.chatMeta.byokBaseUrl) setChatByokBaseUrl(data.chatMeta.byokBaseUrl);
        if (data.chatMeta.byokModel) setChatByokModel(data.chatMeta.byokModel);
        setChatByokApiKey("");
        setClearByokKey(false);
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Failed to load site.");
    } finally {
      setLoadingSiteSlug(null);
    }
  };

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

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setResumeText(text.slice(0, 14000));
  };

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (genMode === "hosted" && !user) {
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
          stylePrompt: stylePrompt.trim() || undefined,
          theme,
          siteUrl,
          providerMode: genMode,
          hostedModelId: genModelId,
          ...(genMode === "byok"
            ? {
                apiKey: genApiKey.trim() || undefined,
                baseUrl: genBaseUrl.trim() || undefined,
                model: genModel.trim() || undefined,
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
    window.localStorage.setItem(
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
          profile: { ...generated, theme, ...(stylePrompt.trim() ? { stylePrompt: stylePrompt.trim() } : {}) },
          chatConfig:
            chatMode === "byok"
              ? {
                  mode: "byok",
                  byokApiKey: chatByokApiKey.trim() || undefined,
                  byokBaseUrl: chatByokBaseUrl.trim() || undefined,
                  byokModel: chatByokModel.trim() || undefined,
                  clearByokKey,
                }
              : {
                  mode: "hosted",
                  hostedModelId: chatHostedModelId,
                },
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        slug?: string;
        expiresAt?: string;
        chatMeta?: ChatMeta;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Publish failed.");
      }
      setPublishedUrl(data.url);
      setPublishedExpires(data.expiresAt ? data.expiresAt.slice(0, 10) : null);
      if (data.chatMeta) {
        setSavedByokMask(data.chatMeta.hasByokKey ? data.chatMeta.byokKeyMask : "");
        setChatByokApiKey("");
        setClearByokKey(false);
      }
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
  const previewStyleVars: React.CSSProperties = {
    ...(generated.designTokens?.accent ? ({ "--accent": generated.designTokens.accent } as React.CSSProperties) : {}),
    ...(generated.designTokens?.bg ? ({ "--bg": generated.designTokens.bg } as React.CSSProperties) : {}),
    ...(generated.designTokens?.surface ? ({ "--surface": generated.designTokens.surface } as React.CSSProperties) : {}),
    ...(generated.designTokens?.radius ? ({ "--radius": generated.designTokens.radius } as React.CSSProperties) : {}),
  };

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

      {user && user.sites.length > 0 && (
        <div className="af-shell af-mysites-bar">
          <span className="af-mysites-label">
            <Globe size={13} /> {lang === "zh" ? "我的已发布站点（点击加载回编辑器）：" : "My published sites:"}
          </span>
          <div className="af-mysites-list">
            {user.sites.map((slug) => (
              <button
                key={slug}
                type="button"
                className={`af-icon-pill ${handle === slug && publishedUrl ? "af-site-active" : ""}`}
                disabled={loadingSiteSlug === slug}
                onClick={() => void loadExistingSite(slug)}
              >
                <span>/u/{slug}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="af-shell af-create-grid">
        <form className="af-create-panel" onSubmit={onGenerate}>
          <div className="af-panel-top">
            <p className="af-eyebrow">STEP 1 · GENERATE</p>
            {hasGenerated && (
              <button type="button" className="af-reset-link" onClick={resetDraft}>
                <RotateCcw size={12} /> {lang === "zh" ? "清空草稿" : "Reset draft"}
              </button>
            )}
          </div>
          <h1>{lang === "zh" ? "把简历变成会说话的网站" : "Turn your resume into a site that talks back"}</h1>

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
            rows={6}
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
              <Palette size={13} /> {lang === "zh" ? "2. 选择布局主题" : "2. Choose layout theme"}
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
              <Wand2 size={13} /> {lang === "zh" ? "3. 自定义风格与人设提示词（可选）" : "3. Style & AI Persona Prompt (optional)"}
            </span>
          </div>
          <div className="af-preset-row">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={stylePrompt === preset.prompt ? "active" : ""}
                onClick={() => setStylePrompt(preset.prompt)}
              >
                {localize(preset.label, lang)}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="af-single-input"
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
            maxLength={400}
            placeholder={
              lang === "zh"
                ? "例：重点突出高并发和 AI 量化指标，主色用深海蓝，AI 回复风格简洁犀利…"
                : "e.g. Emphasize distributed systems metrics, deep blue accent, concise staff-engineer voice…"
            }
          />

          <div className="af-field-label">
            <span>
              <KeyRound size={13} /> {lang === "zh" ? "4. 选择简历生成模型" : "4. Resume generation model"}
            </span>
          </div>
          <div className="af-preset-row">
            <button
              type="button"
              className={genMode === "hosted" ? "active" : ""}
              onClick={() => setGenMode("hosted")}
            >
              {lang === "zh" ? "TalkCV 免费托管额度" : "TalkCV Hosted Free"}
            </button>
            <button
              type="button"
              className={genMode === "byok" ? "active" : ""}
              onClick={() => setGenMode("byok")}
            >
              {lang === "zh" ? "自带 Key 生成（不限次）" : "BYOK (Unlimited)"}
            </button>
          </div>

          {genMode === "hosted" ? (
            <>
              <select
                className="af-select"
                value={genModelId}
                onChange={(e) => setGenModelId(e.target.value)}
                aria-label="Generation model"
              >
                {HOSTED_MODELS.filter((m) => m.id !== "auto").map((m) => (
                  <option key={m.id} value={m.id} disabled={m.tier === "pro"}>
                    {localize(m.label, lang)} {m.tier === "pro" ? "🔒 Pro" : "· Free"}
                  </option>
                ))}
              </select>
              <div className="af-quota-note">
                {user ? (
                  <span>
                    {lang === "zh"
                      ? `已登录 ${user.email} · 今日剩余免费生成 ${remaining}/${user.dailyLimit} 次`
                      : `Signed in as ${user.email} · ${remaining}/${user.dailyLimit} free generations left today`}
                  </span>
                ) : (
                  <button type="button" className="af-inline-link" onClick={() => setAuthModalOpen(true)}>
                    {lang === "zh"
                      ? "👉 点击先用邮箱登录，领取每日 3 次免费生成额度"
                      : "👉 Sign in with email for 3 free daily generations"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="af-preset-row">
                {BYOK_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={genByokPreset === p.id ? "active" : ""}
                    onClick={() => {
                      setGenByokPreset(p.id);
                      setGenBaseUrl(p.baseUrl);
                      setGenModel(p.model);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="af-input-grid">
                <input
                  type="password"
                  value={genApiKey}
                  onChange={(e) => setGenApiKey(e.target.value)}
                  placeholder="API Key (sk-...)"
                  autoComplete="off"
                />
                <input
                  type="text"
                  value={genModel}
                  onChange={(e) => setGenModel(e.target.value)}
                  placeholder="Model (e.g. deepseek-chat)"
                />
                <input
                  type="url"
                  value={genBaseUrl}
                  onChange={(e) => setGenBaseUrl(e.target.value)}
                  placeholder="Base URL"
                />
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="Site URL"
                />
              </div>
            </>
          )}

          {error && <div className="af-ai-error">{error}</div>}

          <button type="submit" className="af-btn af-btn-primary af-create-submit" disabled={loading}>
            <Sparkles size={16} />
            <span>
              {loading
                ? lang === "zh"
                  ? "正在解析简历并定制风格…"
                  : "Generating your TalkCV…"
                : lang === "zh"
                  ? "生成 TalkCV 配置与预览"
                  : "Generate TalkCV Profile"}
            </span>
          </button>
        </form>

        <section className="af-preview-panel" data-theme={theme} style={previewStyleVars}>
          <div className="af-preview-bar">
            <span>
              {hasGenerated
                ? lang === "zh"
                  ? "✅ 已生成你的实时预览（已自动保存草稿）"
                  : "✅ Live preview ready (auto-saved)"
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
            <div className="af-field-label">
              <span>
                <Lock size={13} /> {lang === "zh" ? "STEP 2 · 配置发布后的访客 AI 对话模型" : "STEP 2 · Visitor AI Chat Model (for your live site)"}
              </span>
            </div>
            <div className="af-preset-row">
              <button
                type="button"
                className={chatMode === "hosted" ? "active" : ""}
                onClick={() => setChatMode("hosted")}
              >
                {lang === "zh" ? "TalkCV 托管模型（免费 30 次/天）" : "Hosted Free (30 chats/day)"}
              </button>
              <button
                type="button"
                className={chatMode === "byok" ? "active" : ""}
                onClick={() => setChatMode("byok")}
              >
                {lang === "zh" ? "绑定自有 API Key（解锁无限对话）" : "Bind Your Key (Unlimited Chat)"}
              </button>
            </div>

            {chatMode === "hosted" ? (
              <select
                className="af-select"
                value={chatHostedModelId}
                onChange={(e) => setChatHostedModelId(e.target.value)}
                aria-label="Visitor chat hosted model"
              >
                {HOSTED_MODELS.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.tier === "pro"}>
                    {localize(m.label, lang)} {m.tier === "pro" ? "🔒 Pro" : "· Free"}
                  </option>
                ))}
              </select>
            ) : (
              <div className="af-byok-chat-box">
                {savedByokMask && !clearByokKey && (
                  <div className="af-saved-key-row">
                    <span>
                      {lang === "zh" ? `已加密绑定 Key：${savedByokMask}` : `Encrypted key saved: ${savedByokMask}`}
                    </span>
                    <button
                      type="button"
                      className="af-reset-link"
                      onClick={() => {
                        setClearByokKey(true);
                        setSavedByokMask("");
                      }}
                    >
                      <Trash2 size={12} /> {lang === "zh" ? "清除 Key" : "Remove Key"}
                    </button>
                  </div>
                )}
                <div className="af-input-grid">
                  <input
                    type="password"
                    value={chatByokApiKey}
                    onChange={(e) => {
                      setChatByokApiKey(e.target.value);
                      setClearByokKey(false);
                    }}
                    placeholder={savedByokMask ? "留空则保留已存 Key，或输入新 Key 替换" : "Visitor Chat API Key (sk-...)"}
                    autoComplete="off"
                  />
                  <input
                    type="text"
                    value={chatByokModel}
                    onChange={(e) => setChatByokModel(e.target.value)}
                    placeholder="任意模型名，如 gpt-6.2-sol / deepseek-chat"
                  />
                  <input
                    type="url"
                    value={chatByokBaseUrl}
                    onChange={(e) => setChatByokBaseUrl(e.target.value)}
                    placeholder="Base URL (https://api.openai.com/v1)"
                  />
                </div>
                <p className="af-byok-disclaimer">
                  {lang === "zh"
                    ? "安全说明：Key 经 AES-256-GCM 加密存储，解锁无限对话（仍保留单 IP 15次/分防刷）。建议在模型平台为该 Key 设月度消费上限，随时可清除。"
                    : "Encrypted with AES-256-GCM. Unlocks unlimited visitor chat (15 req/min per-IP abuse guard remains). Set a monthly budget cap on your provider key."}
                </p>
              </div>
            )}

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
                      ? "发布 / 更新专属链接"
                      : "Publish / Update Link"}
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
