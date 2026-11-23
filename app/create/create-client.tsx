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
import { canUseModel, HOSTED_MODELS, type PlanTier } from "../../lib/models";
import { profile as defaultProfile } from "../../lib/profile";
import { localize, THEMES, type Lang, type PortfolioProfile, type ThemeId } from "../../lib/schema";
import { AiRefinePanel } from "./ai-refine-panel";
import { PricingModal } from "./pricing-modal";

interface AuthUser {
  email: string;
  plan?: PlanTier;
  isPro?: boolean;
  isMax?: boolean;
  hasBilling?: boolean;
  usedToday: number;
  dailyLimit: number;
  quotaPeriod?: "lifetime" | "month";
  editUsedToday?: number;
  editDailyLimit?: number;
  sites: string[];
}

function buildPresetAvatarSvg(initials: string, c1: string, c2: string): string {
  const clean = (initials || "TC").slice(0, 2).replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="128" height="128" rx="32" fill="url(#g)"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-weight="800" font-size="52">${clean}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const AVATAR_STYLES = [
  { id: "emerald", label: "Emerald", c1: "#0d7a5f", c2: "#0284c7" },
  { id: "indigo", label: "Indigo", c1: "#4f46e5", c2: "#9333ea" },
  { id: "sunset", label: "Sunset", c1: "#ea580c", c2: "#db2777" },
  { id: "slate", label: "Obsidian", c1: "#0f172a", c2: "#334155" },
] as const;

async function resizeImageToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minSide) / 2;
  const sy = (bitmap.height - minSide) / 2;
  ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.85);
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

function localizeApiError(raw: string, lang: Lang): string {
  if (lang !== "zh") return raw;
  const s = raw.trim();
  if (/An OpenAI-compatible API key is required/i.test(s)) {
    return "自有 Key 模式需要填入 OpenAI 兼容 API Key（或登录账号使用每日免费托管额度）。";
  }
  if (/Please sign in with your email/i.test(s)) {
    return "请先使用邮箱登录以使用 TalkCV 免费托管额度（或切换为自有 API Key）。";
  }
  if (/Daily free generation limit reached/i.test(s)) {
    return "今日免费生成额度（3 次/天）已用完，请明日再试或切换自有 API Key。";
  }
  if (/Please enter your visitor chat API key/i.test(s)) {
    return "请先填写访客对话的自有 API Key（或切换回免费托管模型）。";
  }
  if (/requires TalkCV Pro/i.test(s)) {
    return "该模型为 TalkCV Pro 专属，请升级 Pro 或切换为自有 API Key 使用。";
  }
  if (/Rate limit exceeded/i.test(s)) {
    return "请求过于频繁，请稍等一分钟后再试。";
  }
  if (/at least 30 characters/i.test(s)) {
    return "请至少输入 30 个字符的简历内容。";
  }
  if (/Invalid API key/i.test(s)) {
    return "API Key 无效，请检查后重试。";
  }
  if (/Handle must be/i.test(s)) {
    return "自定义网址仅支持 3–32 位小写字母、数字和连字符。";
  }
  if (/Invalid redemption code/i.test(s)) {
    return "兑换码无效，请检查是否输入正确。";
  }
  if (/already redeemed this code/i.test(s)) {
    return "你的账号已经兑换过该兑换码。";
  }
  if (/already been used/i.test(s)) {
    return "该兑换码已被使用完。";
  }
  if (/Too many redeem attempts/i.test(s)) {
    return "尝试次数过多，请稍等一分钟后再试。";
  }
  return s;
}

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
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingBanner, setBillingBanner] = useState<string | null>(null);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<{
    plan: PlanTier;
    days: number;
    expiresAt: string;
    dailyLimit: number;
    editDailyLimit: number;
  } | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [checkoutBusyTier, setCheckoutBusyTier] = useState<"pro" | "max" | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [editingSkills, setEditingSkills] = useState(false);
  const [skillsDraft, setSkillsDraft] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);

  const currentPlan: PlanTier = user?.plan ?? "free";
  const remainingEdits = user ? Math.max(0, (user.editDailyLimit ?? 0) - (user.editUsedToday ?? 0)) : 0;

  // Restore user session + check ?upgraded=1 return from Creem
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let rafId: number | null = null;
    if (params.get("upgraded")) {
      const upgradedTier = params.get("upgraded") === "max" ? "Max" : "Pro";
      rafId = window.requestAnimationFrame(() => {
        setBillingBanner(
          lang === "zh"
            ? `支付已完成！TalkCV ${upgradedTier} 权益（高级模型 + AI 实时精修 + 更高额度）正在同步生效。`
            : `Payment received! Your TalkCV ${upgradedTier} models, AI Live Refine & higher quotas are activating.`,
        );
      });
      params.delete("upgraded");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((data: { user?: AuthUser | null }) => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [lang]);

  const startPlanCheckout = async (tier: "pro" | "max", interval: "month" | "year") => {
    if (!user) {
      setPricingOpen(false);
      setAuthModalOpen(true);
      return;
    }
    setCheckoutBusyTier(tier);
    setPricingError(null);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier, interval }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      const data = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Could not start checkout.");
      }
      window.location.href = data.checkoutUrl;
      // Reset busy state in case user cancels navigation or navigates back from bfcache
      window.setTimeout(() => setCheckoutBusyTier(null), 4000);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "Could not start checkout.";
      const friendly =
        lang === "zh"
          ? `收银台暂不可用（${rawMsg}）。若支付通道仍在审核中，可先点右下角「兑换码」直接开通体验。`
          : `Checkout unavailable (${rawMsg}). You can also redeem an invite code below.`;
      setPricingError(friendly);
      setCheckoutBusyTier(null);
    }
  };

  const openBillingPortal = async () => {
    setBillingBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { portalUrl?: string; error?: string };
      if (!res.ok || !data.portalUrl) throw new Error(data.error || "Could not open billing portal.");
      window.open(data.portalUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(localizeApiError(err instanceof Error ? err.message : "Could not open billing portal.", lang));
    } finally {
      setBillingBusy(false);
    }
  };

  const submitRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setRedeemModalOpen(false);
      setAuthModalOpen(true);
      return;
    }
    setRedeemErr(null);
    setRedeemBusy(true);
    try {
      const res = await fetch("/api/billing/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: redeemCode.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        plan?: PlanTier;
        isPro?: boolean;
        isMax?: boolean;
        dailyLimit?: number;
        days?: number;
        expiresAt?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Invalid redemption code.");
      }
      const nextPlan: PlanTier = data.plan === "max" ? "max" : "pro";
      const nextDailyLimit = data.dailyLimit ?? (nextPlan === "max" ? 50 : 15);
      const nextEditLimit = nextPlan === "max" ? 100 : 30;
      setUser({
        ...user,
        plan: nextPlan,
        isPro: true,
        isMax: nextPlan === "max",
        dailyLimit: nextDailyLimit,
        editDailyLimit: nextEditLimit,
      });
      setRedeemCode("");
      const expDate = data.expiresAt ? data.expiresAt.slice(0, 10) : "";
      setRedeemSuccess({
        plan: nextPlan,
        days: data.days ?? 30,
        expiresAt: expDate,
        dailyLimit: nextDailyLimit,
        editDailyLimit: nextEditLimit,
      });
      setBillingBanner(
        lang === "zh"
          ? `兑换成功！已开通 TalkCV ${nextPlan.toUpperCase()}（+${data.days ?? 30} 天，有效期至 ${expDate}）。`
          : `Code redeemed! TalkCV ${nextPlan.toUpperCase()} activated (+${data.days ?? 30} days, valid until ${expDate}).`,
      );
    } catch (err) {
      setRedeemErr(localizeApiError(err instanceof Error ? err.message : "Redemption failed.", lang));
    } finally {
      setRedeemBusy(false);
    }
  };

  // Restore saved Studio draft on mount (fixes refresh losing draft & model selectors!)
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
            genMode?: "hosted" | "byok";
            genModelId?: string;
            chatMode?: "hosted" | "byok";
            chatHostedModelId?: string;
          };
          if (typeof d.resumeText === "string") setResumeText(d.resumeText);
          if (typeof d.stylePrompt === "string") setStylePrompt(d.stylePrompt);
          if (d.theme === "editorial" || d.theme === "terminal" || d.theme === "bento") setTheme(d.theme);
          if (typeof d.handle === "string" && d.handle) setHandle(d.handle);
          if (d.genMode === "hosted" || d.genMode === "byok") setGenMode(d.genMode);
          if (typeof d.genModelId === "string" && d.genModelId) setGenModelId(d.genModelId);
          if (d.chatMode === "hosted" || d.chatMode === "byok") setChatMode(d.chatMode);
          if (typeof d.chatHostedModelId === "string" && d.chatHostedModelId) {
            setChatHostedModelId(d.chatHostedModelId);
          }
          if (d.generated && d.hasGenerated) {
            setGenerated(d.generated);
            setHasGenerated(true);
          }
        }
        // Honor ?handle=<slug> from Claim links (takes precedence over draft handle)
        const queryHandle = new URLSearchParams(window.location.search).get("handle")?.trim().toLowerCase();
        if (queryHandle && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(queryHandle)) {
          setHandle(queryHandle);
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
        JSON.stringify({
          resumeText,
          stylePrompt,
          theme,
          handle,
          generated,
          hasGenerated,
          genMode,
          genModelId,
          chatMode,
          chatHostedModelId,
        }),
      );
      if (hasGenerated) {
        window.localStorage.setItem("talkcv-draft-profile", JSON.stringify({ ...generated, theme }));
      }
    } catch {
      // ignore storage quota
    }
  }, [
    draftHydrated,
    resumeText,
    stylePrompt,
    theme,
    handle,
    generated,
    hasGenerated,
    genMode,
    genModelId,
    chatMode,
    chatHostedModelId,
  ]);

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

  const processResumeFile = async (file: File) => {
    setError(null);
    setUploadNote(null);
    const name = file.name || "resume";
    const ext = name.toLowerCase().split(".").pop() || "";

    if (file.size > 5 * 1024 * 1024) {
      setError(lang === "zh" ? "文件超过 5MB 限制，请压缩后再上传。" : "File exceeds the 5 MB limit.");
      return;
    }

    if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "json") {
      const text = await file.text();
      setResumeText(text.slice(0, 14000));
      setUploadNote(lang === "zh" ? `已导入 ${name}` : `Loaded ${name}`);
      return;
    }

    if (ext === "doc") {
      setError(
        lang === "zh"
          ? "暂不支持旧版 .doc 格式，请先另存为 .docx 或导出 .pdf 再上传。"
          : "Legacy .doc is not supported directly. Please save as .docx or .pdf and upload again.",
      );
      return;
    }

    if (ext !== "pdf" && ext !== "docx") {
      setError(
        lang === "zh"
          ? "不支持该文件格式，请上传 .pdf、.docx、.md、.txt 或 .json 简历。"
          : "Unsupported format. Please upload .pdf, .docx, .md, .txt, or .json.",
      );
      return;
    }

    setUploadingFile(true);
    try {
      const res = await fetch("/api/parse-resume", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-filename": encodeURIComponent(name),
        },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        pages?: number;
        code?: string;
        error?: string;
      };
      if (!res.ok || !data.text) {
        if (data.code === "SCANNED_PDF") {
          throw new Error(
            lang === "zh"
              ? "检测到这份 PDF 可能是纯图片扫描件，无法直接提取文字。请导出可复制文字版 PDF / Word（.docx），或直接粘贴文本。"
              : data.error || "Scanned image PDF detected.",
          );
        }
        throw new Error(data.error || (lang === "zh" ? "文件解析失败，请检查文件是否加密或损坏。" : "Failed to parse file."));
      }
      setResumeText(data.text.slice(0, 14000));
      setUploadNote(
        lang === "zh"
          ? `已成功解析 ${name}${data.pages ? `（共 ${data.pages} 页，${data.text.length} 字）` : `（${data.text.length} 字）`}`
          : `Parsed ${name}${data.pages ? ` (${data.pages} pages, ${data.text.length} chars)` : ` (${data.text.length} chars)`}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : lang === "zh" ? "简历解析失败。" : "Failed to parse resume.");
    } finally {
      setUploadingFile(false);
    }
  };

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processResumeFile(file);
  };

  const onAvatarFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarErr(null);
    if (!file.type.startsWith("image/")) {
      setAvatarErr(lang === "zh" ? "请上传图片文件（PNG / JPG / WebP）。" : "Please upload an image file.");
      return;
    }
    try {
      const dataUrl = await resizeImageToAvatarDataUrl(file);
      setGenerated((prev) => ({ ...prev, basics: { ...prev.basics, avatar: dataUrl } }));
      setHasGenerated(true);
      setAvatarMenuOpen(false);
    } catch {
      setAvatarErr(lang === "zh" ? "图片处理失败，请换一张重试。" : "Failed to process image.");
    }
  };

  const generateAiAvatar = async () => {
    if (!user?.isPro) {
      setAvatarMenuOpen(false);
      setPricingOpen(true);
      return;
    }
    setAvatarBusy(true);
    setAvatarErr(null);
    try {
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: localize(generated.basics.name, lang),
          role: localize(generated.basics.role, lang),
          stylePrompt: stylePrompt.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; avatar?: string; error?: string };
      if (!res.ok || !data.avatar) {
        throw new Error(data.error || "AI avatar generation failed.");
      }
      setGenerated((prev) => ({ ...prev, basics: { ...prev.basics, avatar: data.avatar } }));
      setHasGenerated(true);
      setAvatarMenuOpen(false);
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : "AI avatar generation failed.");
    } finally {
      setAvatarBusy(false);
    }
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
      setError(localizeApiError(err instanceof Error ? err.message : "Failed to generate profile.", lang));
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
      setPublishError(localizeApiError(err instanceof Error ? err.message : "Publish failed.", lang));
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
            <>
              <div className="af-user-pill">
                <User size={13} />
                <span>{user.email}</span>
                {user.isPro && (
                  <em style={{ background: "var(--accent)", color: "var(--accent-ink)", padding: "1px 6px", borderRadius: 999 }}>
                    {user.isMax ? "MAX" : "PRO"}
                  </em>
                )}
                <em>
                  {lang === "zh"
                    ? user.quotaPeriod === "month"
                      ? `本月剩 ${remaining}/${user.dailyLimit} 次`
                      : `剩余 ${remaining}/${user.dailyLimit} 次`
                    : user.quotaPeriod === "month"
                      ? `${remaining}/${user.dailyLimit}/mo`
                      : `${remaining}/${user.dailyLimit} left`}
                </em>
                <button type="button" onClick={logout} title={lang === "zh" ? "退出登录" : "Sign out"}>
                  <LogOut size={12} />
                </button>
              </div>
              {user.isPro && (
                <button type="button" className="af-icon-pill" onClick={openBillingPortal} disabled={billingBusy}>
                  <span>{lang === "zh" ? "管理订阅" : "Billing"}</span>
                </button>
              )}
              {!user.isMax && (
                <button
                  type="button"
                  className="af-icon-pill af-login-pill"
                  onClick={() => setPricingOpen(true)}
                >
                  <Sparkles size={13} />
                  <span>{lang === "zh" ? (user.isPro ? "升级 Max" : "升级会员") : user.isPro ? "Upgrade Max" : "Upgrade"}</span>
                </button>
              )}
              <button
                type="button"
                className="af-icon-pill"
                onClick={() => {
                  setRedeemErr(null);
                  setRedeemSuccess(null);
                  setRedeemModalOpen(true);
                }}
              >
                <KeyRound size={13} />
                <span>{lang === "zh" ? "兑换码" : "Redeem"}</span>
              </button>
            </>
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

      {billingBanner && (
        <div className="af-shell af-mysites-bar" role="status">
          <Sparkles size={14} />
          <span>{billingBanner}</span>
          <button type="button" className="af-inline-link" onClick={() => setBillingBanner(null)}>
            <X size={13} />
          </button>
        </div>
      )}

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
              <span>
                {uploadingFile
                  ? lang === "zh"
                    ? "解析文件中…"
                    : "Parsing…"
                  : lang === "zh"
                    ? "上传 PDF / Word / MD"
                    : "Upload PDF / DOCX / MD"}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.md,.txt,.json"
                onChange={onFileUpload}
                disabled={uploadingFile}
                hidden
              />
            </label>
          </label>
          {uploadNote && (
            <div className="af-quota-note" style={{ marginBottom: 6 }}>
              ✓ {uploadNote}
            </div>
          )}
          <textarea
            className="af-textarea"
            style={dragOver ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent-soft)" } : undefined}
            rows={6}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void processResumeFile(file);
            }}
            placeholder={
              lang === "zh"
                ? "可直接拖入 PDF / Word (.docx) / Markdown 简历文件，或把简历全文粘贴在这里…"
                : "Drop a PDF / Word (.docx) / Markdown resume here, or paste your resume text…"
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
                  <option key={m.id} value={m.id} disabled={!canUseModel(m.id, currentPlan)}>
                    {localize(m.label, lang)}{" "}
                    {m.tier === "free"
                      ? "· Free"
                      : canUseModel(m.id, currentPlan)
                        ? `★ ${m.tier.toUpperCase()}`
                        : `🔒 ${m.tier.toUpperCase()}`}
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
                  <option key={m.id} value={m.id} disabled={!canUseModel(m.id, currentPlan)}>
                    {localize(m.label, lang)}{" "}
                    {m.tier === "free"
                      ? "· Free"
                      : canUseModel(m.id, currentPlan)
                        ? `★ ${m.tier.toUpperCase()}`
                        : `🔒 ${m.tier.toUpperCase()}`}
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
            <label className="af-whitelabel-row">
              <input
                type="checkbox"
                checked={Boolean(generated.hideBranding)}
                onChange={(e) => {
                  if (!user?.isMax) {
                    setPricingOpen(true);
                    return;
                  }
                  setGenerated((prev) => ({ ...prev, hideBranding: e.target.checked }));
                  setHasGenerated(true);
                }}
              />
              <span>
                {lang === "zh"
                  ? "隐藏底部「由 TalkCV 托管」水印（Max 白标商用专属）"
                  : "Hide 'Hosted with TalkCV' footer watermark (Max Agency)"}
              </span>
              {!user?.isMax && <Lock size={11} />}
            </label>
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

          <div className="af-edit-toolbar">
            <span className="af-inline-edit-hint">
              ✏️ {lang === "zh" ? "所见即所得：点击下方任意文字或指标即可直接编辑" : "WYSIWYG: Click any text or metric below to edit inline"}
            </span>
            <button
              type="button"
              className={`af-icon-pill ${refineOpen ? "af-login-pill" : ""}`}
              onClick={() => {
                const canAiEdit = Boolean(user?.isPro) || (genMode === "byok" && Boolean(genApiKey.trim()));
                if (!canAiEdit) {
                  setPricingOpen(true);
                  return;
                }
                setRefineOpen((prev) => !prev);
              }}
            >
              <Sparkles size={13} />
              <span>
                {lang === "zh"
                  ? user?.isPro
                    ? `AI 实时精修（剩 ${remainingEdits}/${user.editDailyLimit ?? 30}）`
                    : "✨ AI 实时精修 (Pro/Max)"
                  : user?.isPro
                    ? `AI Refine (${remainingEdits}/${user.editDailyLimit ?? 30})`
                    : "✨ AI Live Refine (Pro)"}
              </span>
            </button>
          </div>

          {refineOpen && (
            <AiRefinePanel
              lang={lang}
              profile={generated}
              theme={theme}
              hostedModelId={genModelId}
              providerMode={genMode}
              apiKey={genApiKey}
              baseUrl={genBaseUrl}
              byokModel={genModel}
              remainingEdits={remainingEdits}
              editDailyLimit={user?.editDailyLimit ?? 30}
              onApplyProfile={(nextProfile, quota) => {
                setGenerated(nextProfile);
                setHasGenerated(true);
                if (nextProfile.theme) setTheme(nextProfile.theme);
                if (quota && user) {
                  setUser({ ...user, editUsedToday: quota.usedToday, editDailyLimit: quota.dailyLimit });
                }
              }}
              onClose={() => setRefineOpen(false)}
            />
          )}

          <div className="af-preview-canvas">
            <div className="af-avatar-bar">
              <button
                type="button"
                className="af-avatar-trigger"
                onClick={() => {
                  setAvatarErr(null);
                  setAvatarMenuOpen((v) => !v);
                }}
                title={lang === "zh" ? "点击更换个人头像 / 标签页图标" : "Click to customize avatar & favicon"}
              >
                {generated.basics.avatar ? (
                  <img
                    className="af-brand-avatar af-brand-avatar-lg"
                    src={generated.basics.avatar}
                    alt={localize(generated.basics.name, lang)}
                  />
                ) : (
                  <span className="af-brand-mark af-brand-mark-lg">{generated.basics.initials}</span>
                )}
                <span className="af-avatar-hint">
                  {lang === "zh" ? "更换头像" : "Edit Avatar"}
                </span>
              </button>
              {avatarMenuOpen && (
                <div className="af-avatar-picker">
                  <div className="af-avatar-picker-row">
                    <label className="af-icon-pill" style={{ cursor: "pointer" }}>
                      <FileUp size={12} />
                      <span>{lang === "zh" ? "上传照片" : "Upload Photo"}</span>
                      <input type="file" accept="image/*" onChange={onAvatarFileUpload} hidden />
                    </label>
                    <button
                      type="button"
                      className="af-icon-pill af-login-pill"
                      onClick={generateAiAvatar}
                      disabled={avatarBusy}
                    >
                      <Sparkles size={12} />
                      <span>
                        {avatarBusy
                          ? lang === "zh"
                            ? "AI 绘制中…"
                            : "Generating…"
                          : lang === "zh"
                            ? user?.isPro
                              ? "AI 生成头像"
                              : "✨ AI 头像 (Pro)"
                            : user?.isPro
                              ? "AI Avatar"
                              : "✨ AI Avatar (Pro)"}
                      </span>
                    </button>
                    {generated.basics.avatar && (
                      <button
                        type="button"
                        className="af-icon-pill"
                        onClick={() => {
                          setGenerated((prev) => ({ ...prev, basics: { ...prev.basics, avatar: undefined } }));
                          setAvatarMenuOpen(false);
                        }}
                      >
                        <Trash2 size={12} />
                        <span>{lang === "zh" ? "恢复默认" : "Reset"}</span>
                      </button>
                    )}
                  </div>
                  <div className="af-avatar-presets">
                    {AVATAR_STYLES.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        className="af-avatar-swatch"
                        style={{ background: `linear-gradient(135deg, ${st.c1}, ${st.c2})` }}
                        title={st.label}
                        onClick={() => {
                          const svgUrl = buildPresetAvatarSvg(generated.basics.initials, st.c1, st.c2);
                          setGenerated((prev) => ({ ...prev, basics: { ...prev.basics, avatar: svgUrl } }));
                          setHasGenerated(true);
                          setAvatarMenuOpen(false);
                        }}
                      >
                        {generated.basics.initials}
                      </button>
                    ))}
                  </div>
                  {avatarErr && <div className="af-ai-error">{avatarErr}</div>}
                </div>
              )}
            </div>
            <p
              className="af-role af-editable"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const val = e.currentTarget.textContent?.trim() ?? "";
                if (!val) return;
                setGenerated((prev) => ({
                  ...prev,
                  basics: { ...prev.basics, role: { ...prev.basics.role, [lang]: val } },
                }));
                setHasGenerated(true);
              }}
            >
              {localize(generated.basics.role, lang)}
            </p>
            <h2
              className="af-editable"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const val = e.currentTarget.textContent?.trim() ?? "";
                if (!val) return;
                setGenerated((prev) => ({
                  ...prev,
                  basics: { ...prev.basics, name: { ...prev.basics.name, [lang]: val } },
                }));
                setHasGenerated(true);
              }}
            >
              {localize(generated.basics.name, lang)}
            </h2>
            <p
              className="af-preview-headline af-editable"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const val = e.currentTarget.textContent?.trim() ?? "";
                if (!val) return;
                setGenerated((prev) => ({
                  ...prev,
                  basics: { ...prev.basics, headline: { ...prev.basics.headline, [lang]: val } },
                }));
                setHasGenerated(true);
              }}
            >
              {localize(generated.basics.headline, lang)}
            </p>
            <p
              className="af-card-summary af-editable"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const val = e.currentTarget.textContent?.trim() ?? "";
                if (!val) return;
                setGenerated((prev) => ({
                  ...prev,
                  basics: { ...prev.basics, intro: { ...prev.basics.intro, [lang]: val } },
                }));
                setHasGenerated(true);
              }}
            >
              {localize(generated.basics.intro, lang)}
            </p>

            {editingSkills ? (
              <div className="af-skills-editor">
                <input
                  type="text"
                  value={skillsDraft}
                  onChange={(e) => setSkillsDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const next = skillsDraft
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(0, 18);
                      setGenerated((prev) => ({ ...prev, skills: next }));
                      setHasGenerated(true);
                      setEditingSkills(false);
                    }
                  }}
                  placeholder={lang === "zh" ? "用逗号分隔技能，回车保存" : "Comma-separated skills, press Enter"}
                  autoFocus
                />
                <button
                  type="button"
                  className="af-icon-pill"
                  onClick={() => {
                    const next = skillsDraft
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 18);
                    setGenerated((prev) => ({ ...prev, skills: next }));
                    setHasGenerated(true);
                    setEditingSkills(false);
                  }}
                >
                  <Check size={12} /> {lang === "zh" ? "保存" : "Save"}
                </button>
              </div>
            ) : (
              <div
                className="af-skill-strip af-editable"
                title={lang === "zh" ? "点击编辑技能标签" : "Click to edit skills"}
                onClick={() => {
                  setSkillsDraft(generated.skills.join(", "));
                  setEditingSkills(true);
                }}
              >
                {generated.skills.slice(0, 12).map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            )}

            <div className="af-preview-projects">
              {generated.projects.slice(0, 3).map((proj, pIdx) => (
                <article key={proj.slug} className="af-card">
                  <span
                    className="af-card-cat af-editable"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() ?? "";
                      if (!val) return;
                      setGenerated((prev) => ({
                        ...prev,
                        projects: prev.projects.map((item, idx) =>
                          idx === pIdx ? { ...item, category: { ...item.category, [lang]: val } } : item,
                        ),
                      }));
                      setHasGenerated(true);
                    }}
                  >
                    {localize(proj.category, lang)}
                  </span>
                  <h3
                    className="af-editable"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() ?? "";
                      if (!val) return;
                      setGenerated((prev) => ({
                        ...prev,
                        projects: prev.projects.map((item, idx) =>
                          idx === pIdx ? { ...item, title: { ...item.title, [lang]: val } } : item,
                        ),
                      }));
                      setHasGenerated(true);
                    }}
                  >
                    {localize(proj.title, lang)}
                  </h3>
                  <p
                    className="af-card-summary af-editable"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() ?? "";
                      if (!val) return;
                      setGenerated((prev) => ({
                        ...prev,
                        projects: prev.projects.map((item, idx) =>
                          idx === pIdx ? { ...item, summary: { ...item.summary, [lang]: val } } : item,
                        ),
                      }));
                      setHasGenerated(true);
                    }}
                  >
                    {localize(proj.summary, lang)}
                  </p>
                  <div className="af-facts">
                    {proj.facts.slice(0, 3).map((f, fIdx) => (
                      <div key={fIdx}>
                        <strong
                          className="af-editable"
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => {
                            const val = e.currentTarget.textContent?.trim() ?? "";
                            if (!val) return;
                            setGenerated((prev) => ({
                              ...prev,
                              projects: prev.projects.map((item, idx) =>
                                idx === pIdx
                                  ? {
                                      ...item,
                                      facts: item.facts.map((fact, fi) =>
                                        fi === fIdx ? { ...fact, value: val } : fact,
                                      ),
                                    }
                                  : item,
                              ),
                            }));
                            setHasGenerated(true);
                          }}
                        >
                          {f.value}
                        </strong>
                        <span
                          className="af-editable"
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => {
                            const val = e.currentTarget.textContent?.trim() ?? "";
                            if (!val) return;
                            setGenerated((prev) => ({
                              ...prev,
                              projects: prev.projects.map((item, idx) =>
                                idx === pIdx
                                  ? {
                                      ...item,
                                      facts: item.facts.map((fact, fi) =>
                                        fi === fIdx ? { ...fact, label: { ...fact.label, [lang]: val } } : fact,
                                      ),
                                    }
                                  : item,
                              ),
                            }));
                            setHasGenerated(true);
                          }}
                        >
                          {localize(f.label, lang)}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>

      <PricingModal
        open={pricingOpen}
        onClose={() => {
          setPricingOpen(false);
          setCheckoutBusyTier(null);
          setPricingError(null);
        }}
        lang={lang}
        currentPlan={currentPlan}
        busyTier={checkoutBusyTier}
        error={pricingError}
        onSelectPlan={startPlanCheckout}
        onOpenRedeem={() => {
          setRedeemErr(null);
          setRedeemSuccess(null);
          setRedeemModalOpen(true);
        }}
      />

      {redeemModalOpen && (
        <div
          className="af-cmd-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setRedeemModalOpen(false);
            setRedeemSuccess(null);
          }}
        >
          <div className="af-auth-modal" onClick={(e) => e.stopPropagation()}>
            <div className="af-auth-head">
              <strong>
                {redeemSuccess ? <Sparkles size={15} /> : <KeyRound size={15} />}{" "}
                {redeemSuccess
                  ? lang === "zh"
                    ? `兑换成功 · TalkCV ${redeemSuccess.plan.toUpperCase()}`
                    : `Redeemed · TalkCV ${redeemSuccess.plan.toUpperCase()}`
                  : lang === "zh"
                    ? "兑换会员邀请码"
                    : "Redeem Invite Code"}
              </strong>
              <button
                type="button"
                onClick={() => {
                  setRedeemModalOpen(false);
                  setRedeemSuccess(null);
                }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
            {redeemSuccess ? (
              <div className="af-auth-form">
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
                  🎉{" "}
                  {lang === "zh"
                    ? `欢迎加入 TalkCV ${redeemSuccess.plan.toUpperCase()}！`
                    : `Welcome to TalkCV ${redeemSuccess.plan.toUpperCase()}!`}
                </p>
                <div className="af-quota-note" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span>
                    ✓ {lang === "zh" ? `已增加 ${redeemSuccess.days} 天会员，有效期至 ${redeemSuccess.expiresAt}` : `+${redeemSuccess.days} days active until ${redeemSuccess.expiresAt}`}
                  </span>
                  <span>
                    ✓ {lang === "zh" ? `每日简历生成提升至 ${redeemSuccess.dailyLimit} 次/天` : `${redeemSuccess.dailyLimit} AI generations / day`}
                  </span>
                  <span>
                    ✓ {lang === "zh" ? `已解锁 AI 多轮实时精修（${redeemSuccess.editDailyLimit} 次/天）` : `AI Multi-turn Live Refine unlocked (${redeemSuccess.editDailyLimit}/day)`}
                  </span>
                  <span>
                    ✓{" "}
                    {lang === "zh"
                      ? redeemSuccess.plan === "max"
                        ? "全部旗舰模型（GPT-6.2 Sol / 6.1 / 5.4）与高级模型已解锁"
                        : "DeepSeek V4.1 Flash / R1 / GPT-4o / o3-mini 已解锁"
                      : "Premium hosted models are now unlocked"}
                  </span>
                </div>
                <button
                  type="button"
                  className="af-btn af-btn-primary"
                  onClick={() => {
                    setRedeemModalOpen(false);
                    setRedeemSuccess(null);
                  }}
                >
                  {lang === "zh" ? "太好了，开始体验 →" : "Awesome, let's build →"}
                </button>
              </div>
            ) : (
              <form className="af-auth-form" onSubmit={submitRedeemCode}>
                <p>
                  {lang === "zh"
                    ? "输入内测或活动兑换码，立即解锁高级模型、AI 多轮实时精修与更高托管额度。"
                    : "Enter your invite code to unlock premium models, AI Live Refine, and higher quotas."}
                </p>
                <input
                  type="text"
                  required
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                  placeholder="TALKCV-XXXX-XXXX"
                />
                {redeemErr && <div className="af-ai-error">{redeemErr}</div>}
                <button type="submit" className="af-btn af-btn-primary" disabled={redeemBusy || !redeemCode.trim()}>
                  {redeemBusy ? (lang === "zh" ? "兑换中…" : "Redeeming…") : lang === "zh" ? "立即兑换" : "Redeem Now"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

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
