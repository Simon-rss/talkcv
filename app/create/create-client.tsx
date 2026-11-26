"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Globe,
  ImagePlus,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  User,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CREDIT_COST, PLAN_CREDITS, REFERRAL_CREDITS, creditCostLabel, type CreditBalance } from "../../lib/credits";
import { canUseModel, HOSTED_MODELS, isPromoUnlockedModel, type PlanTier } from "../../lib/models";
import { PromoAnnouncementCard, PromoTopBanner } from "../promo-announcement";
import { captureReferral, readSession, type AuthUser } from "../../lib/login";
import { profile as defaultProfile } from "../../lib/profile";
import {
  AI_BRIEF_LIMITS,
  designTokensToCssVars,
  FONT_PAIR_OPTIONS,
  HERO_STYLE_OPTIONS,
  localize,
  normalizeSlug,
  PROJECT_LAYOUT_OPTIONS,
  STYLE_PRESETS,
  THEMES,
  type AiBrief,
  type FontPair,
  type HeroStyle,
  type Lang,
  type PortfolioProfile,
  type ProjectLayout,
  type SectionId,
  type ThemeId,
} from "../../lib/schema";
import { SiteInsights } from "./site-insights";
import { StudioLoginDialog } from "../login/login-client";
import { OnboardingTour } from "./onboarding-tour";
import { AiRefinePanel } from "./ai-refine-panel";
import { OutreachPanel } from "./outreach-panel";
import { SharePoster } from "../share-poster";
import { ContactLinks } from "../contact-links";
import { SiteLinks } from "../public-navigation";
import { PricingModal, requestCheckout, type CheckoutTier } from "./pricing-modal";
import { PdfQrStamper } from "./pdf-qr-stamper";
import { PdfResumeBuilder } from "./pdf-resume-builder";

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

async function resizeImageToProjectCoverDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxW = 1120;
  const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.82);
}

async function resizeResumeImageForOcr(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1600;
  const scale = Math.max(bitmap.width, bitmap.height) > maxDim ? maxDim / Math.max(bitmap.width, bitmap.height) : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.86);
}

interface ChatMeta {
  mode: "hosted" | "byok";
  hostedModelId: string;
  hasByokKey: boolean;
  byokKeyMask: string;
  byokBaseUrl: string;
  byokModel: string;
}

const BYOK_PRESETS = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
] as const;

const STUDIO_DRAFT_KEY = "talkcv-studio-draft";
const DEFAULT_HANDLE = "your-name";
const SAMPLE_TRIAL_RESUME_ZH = `林致远 | 高级全栈 & AI 应用工程师 | 上海 | 邮箱：demo@example.com
教育背景：上海交通大学 · 软件工程 本科（2017–2021）
核心技能：TypeScript, React, Next.js, Python, FastAPI, PostgreSQL, Redis, AI Agent, RAG

工作经历：
1. 云帆协作科技（2023.03 – 至今）· 高级全栈工程师
- 负责企业级 AI 知识库与工作流产品研发，服务 40+ 企业团队，日均处理 12 万次问答请求。
2. 星海互娱（2021.07 – 2023.02）· 前端开发工程师
- 主导低代码活动搭建平台重构，首屏加载耗时从 2.8s 降至 0.9s（-68%），支撑大促零故障。

代表项目：
1. 智能客服与 RAG 知识引擎（技术负责人）
- 设计混合检索（BM25 + 向量）与引用溯源机制，回答准确率提升 34%，人工转接率下降 41%。
2. 实时协同表单工作台（核心开发）
- 基于增量补丁同步与乐观锁解决多人编辑冲突，单次保存体积减少 52%，覆盖 15,000+ 日活用户。`;
const SAMPLE_TRIAL_RESUME_EN = `Liam Lin | Senior Full-Stack & AI Engineer | San Francisco | Email: demo@example.com
Education: B.S. in Computer Science (2017–2021)
Skills: TypeScript, React, Next.js, Python, FastAPI, PostgreSQL, Redis, AI Agents, RAG

Experience:
1. CloudSail AI (2023.03 – Present) · Senior Full-Stack Engineer
- Built enterprise RAG & workflow platform serving 40+ teams and 120k daily AI queries.
2. StarWave Tech (2021.07 – 2023.02) · Frontend Engineer
- Re-architected campaign builder, cutting initial load time from 2.8s to 0.9s (-68%).

Featured Projects:
1. Grounded Enterprise RAG Engine (Tech Lead)
- Built hybrid BM25 + vector retrieval with inline citations; raised answer accuracy +34% and reduced escalations -41%.
2. Real-Time Collaborative Form Studio (Core Engineer)
- Implemented incremental patch sync and optimistic locking, cutting save payload by 52% for 15,000+ DAU.`;
const BRIEF_LABELS = {
  expectedSalary: ["期望薪资", "Expected salary"], availability: ["最快到岗时间", "Earliest start date"],
  workMode: ["城市 / 远程偏好", "Location / remote preference"], notes: ["补充说明", "Additional notes"],
  redLines: ["禁止回答的话题", "Topics the AI must decline"],
} as const;

function localizeApiError(raw: string, lang: Lang): string {
  if (lang !== "zh") return raw;
  const s = raw.trim();
  if (/An OpenAI-compatible API key is required/i.test(s)) {
    return "自有 Key 模式需要填入 OpenAI 兼容 API Key（或登录后使用托管点数）。";
  }
  if (/Please sign in with your email/i.test(s)) {
    return "请先使用邮箱登录以使用 TalkCV 托管点数（或切换为自有 API Key）。";
  }
  if (/Daily free generation limit reached/i.test(s)) {
    return "账号剩余点数不足，可升级套餐或使用自有 API Key。";
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
  if (/Check the email address and contact links/i.test(s)) return "请检查邮箱、GitHub、LinkedIn 及博客网址后再发布。";
  if (/Invalid AI brief/i.test(s)) return "请检查求职备忘的内容和字段长度。";
  if (/Profile payload is too large/i.test(s)) return "简历和备忘的总大小超过 2 MB，请压缩图片或精简后再发布。";
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

type CheckoutChoice = { tier: CheckoutTier; interval: "month" | "year" };

export function CreateStudioClient({ initialLang = "zh", checkout }: { initialLang?: Lang; checkout?: CheckoutChoice }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [pendingCheckout, setPendingCheckout] = useState(checkout);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(Boolean(checkout));
  const [authIntent, setAuthIntent] = useState<"generate" | "publish" | null>(null);

  // Generation section state
  const [resumeText, setResumeText] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [theme, setTheme] = useState<ThemeId>("editorial");
  const [siteUrl, setSiteUrl] = useState("https://mytalkcv.com");
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
  const draftOwnerRef = useRef<string | undefined>(undefined);
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
  const [handle, setHandle] = useState(DEFAULT_HANDLE);
  const [briefDraft, setBriefDraft] = useState<{ owner?: string; slug?: string; values: AiBrief }>();
  const briefSlug = normalizeSlug(handle);
  const briefOwner = user?.email;
  const existingBrief = Boolean(user?.sites.includes(briefSlug));
  const aiBrief = briefDraft?.owner === briefOwner && (briefDraft?.slug === briefSlug || (!existingBrief && !briefDraft?.slug))
    ? briefDraft?.values : undefined;
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefReadError, setBriefReadError] = useState(false);
  const needsBrief = existingBrief && !aiBrief;
  useEffect(() => {
    if (!briefOpen || !needsBrief) return;
    const controller = new AbortController();
    fetch(`/api/profiles/${encodeURIComponent(briefSlug)}?edit=1`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!controller.signal.aborted) setBriefDraft({ owner: briefOwner, slug: briefSlug, values: data.aiBrief ?? {} });
      })
      .catch(() => { if (!controller.signal.aborted) setBriefReadError(true); });
    return () => controller.abort();
  }, [briefOpen, needsBrief, briefOwner, briefSlug]);
  const [noindex, setNoindex] = useState<boolean>();
  const [protectedSite, setProtectedSite] = useState<boolean>();
  const [passcode, setPasscode] = useState("");
  const [savedPasscodeSlug, setSavedPasscodeSlug] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedProfile, setPublishedProfile] = useState<PortfolioProfile | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishedExpires, setPublishedExpires] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [loadingSiteSlug, setLoadingSiteSlug] = useState<string | null>(null);
  const [siteActionError, setSiteActionError] = useState("");
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
  } | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [checkoutBusyTier, setCheckoutBusyTier] = useState<CheckoutTier | null>(null);
  const [cloneNotice, setCloneNotice] = useState<string | null>(null);
  const [externalMountOrigin, setExternalMountOrigin] = useState<string | null>(null);
  const handleInputRef = useRef<HTMLInputElement>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [customGenLoading, setCustomGenLoading] = useState(false);
  const [customGenError, setCustomGenError] = useState<string | null>(null);
  const [customRefineInput, setCustomRefineInput] = useState("");
  const [jdTailorOpen, setJdTailorOpen] = useState(false);
  const [jdTailorText, setJdTailorText] = useState("");
  const [jdTailorSuffix, setJdTailorSuffix] = useState("");
  const [jdTailorLoading, setJdTailorLoading] = useState(false);
  const [jdTailorError, setJdTailorError] = useState<string | null>(null);
  const [jdTailorNote, setJdTailorNote] = useState<string | null>(null);
  const [editingSkills, setEditingSkills] = useState(false);
  const [skillsDraft, setSkillsDraft] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);

  const resetDraft = useCallback(() => {
    setBriefDraft(undefined);
    setResumeText("");
    setStylePrompt("");
    setGenerated(defaultProfile);
    setHasGenerated(false);
    setHandle(DEFAULT_HANDLE);
    setNoindex(undefined);
    setProtectedSite(undefined);
    setPasscode("");
    setSavedPasscodeSlug("");
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
  }, []);
  const [pendingRefCode, setPendingRefCode] = useState<string>("");
  const [copiedRef, setCopiedRef] = useState(false);

  const currentPlan: PlanTier = user?.plan ?? "free";
  function updateCredits(email: string | undefined, credits?: CreditBalance | null) {
    if (email && credits) setUser((current) => current?.email === email ? { ...current, credits } : current);
  }

  // Restore user session + check ?upgraded= / ?ref=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let rafId: number | null = null;
    const activeRef = captureReferral(params.get("ref"));
    if (params.get("upgraded") || activeRef) {
      const upgradedParam = params.get("upgraded");
      rafId = window.requestAnimationFrame(() => {
        if (activeRef) setPendingRefCode(activeRef);
        if (upgradedParam) {
          const upgradedTier = upgradedParam === "max" ? "Max" : "Pro";
          setBillingBanner(
            lang === "zh"
              ? `支付已完成！TalkCV ${upgradedTier} 权益（高级模型、AI 实时精修和每月点数）正在同步生效。`
              : `Payment received! Your TalkCV ${upgradedTier} models, AI Live Refine and monthly credits are activating.`,
          );
        }
      });
      if (upgradedParam) {
        params.delete("upgraded");
        const q = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
      }
    }
    const controller = new AbortController();
    const syncSession = () =>
      readSession(controller.signal)
        .then((current) => {
          if (controller.signal.aborted) return;
          const nextEmail = current?.email;
          if (draftOwnerRef.current && nextEmail !== draftOwnerRef.current) {
            draftOwnerRef.current = nextEmail;
            resetDraft();
          } else if (nextEmail && !draftOwnerRef.current) {
            draftOwnerRef.current = nextEmail;
          }
          setUser(current);
        })
        .catch(() => {});
    void syncSession();
    const onFocus = () => void syncSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncSession();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [lang, resetDraft]);

  const startPlanCheckout = async (tier: CheckoutTier, interval: "month" | "year", discountCode?: string) => {
    setCheckoutBusyTier(tier);
    setPricingError(null);
    try {
      const url = await requestCheckout(tier, interval, lang === "zh" ? "onetime" : "subscription", discountCode);
      if (url) {
        window.location.assign(url);
      } else {
        setPendingCheckout({ tier, interval });
        setPricingOpen(false);
        setAuthModalOpen(true);
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "";
      setPricingError(msg || (lang === "zh" ? "暂时无法打开收银台，请稍后重试。" : "Checkout is unavailable. Please try again later."));
      setPricingOpen(true);
    } finally {
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
      setBillingBanner(localizeApiError(err instanceof Error ? err.message : "Could not open billing portal.", lang));
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
        dailyLimit: number;
        editDailyLimit: number;
        credits: CreditBalance;
        maxSites: number;
        days?: number;
        expiresAt?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Invalid redemption code.");
      }
      const nextPlan: PlanTier = data.plan === "max" ? "max" : "pro";
      const nextDailyLimit = data.dailyLimit;
      const nextEditLimit = data.editDailyLimit;
      setUser({
        ...user,
        plan: nextPlan,
        quotaPeriod: "month",
        maxSites: data.maxSites,
        credits: data.credits,
        isPro: true,
        isMax: nextPlan === "max",
        isTrial: false,
        dailyLimit: nextDailyLimit,
        editDailyLimit: nextEditLimit,
      });
      fetch("/api/auth/me")
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((me: { user?: AuthUser | null } | null) => {
          if (me?.user) setUser(me.user);
        })
        .catch(() => {});
      setRedeemCode("");
      const expDate = data.expiresAt ? data.expiresAt.slice(0, 10) : "";
      setRedeemSuccess({
        plan: nextPlan,
        days: data.days ?? 30,
        expiresAt: expDate,
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
            ownerEmail?: string;
            resumeText?: string;
            stylePrompt?: string;
            theme?: ThemeId;
            handle?: string;
            generated?: PortfolioProfile;
            noindex?: boolean;
            protectedSite?: boolean;
            savedPasscodeSlug?: string;
            hasGenerated?: boolean;
            genMode?: "hosted" | "byok";
            genModelId?: string;
            chatMode?: "hosted" | "byok";
            chatHostedModelId?: string;
          };
          if (typeof d.ownerEmail === "string" && d.ownerEmail) draftOwnerRef.current = d.ownerEmail;
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
          setNoindex(d.noindex);
          setProtectedSite(d.protectedSite);
          setSavedPasscodeSlug(d.savedPasscodeSlug ?? "");
          if (d.generated && d.hasGenerated) {
            setGenerated(d.generated);
            setHasGenerated(true);
          }
        }
        // Honor ?handle=<slug> from Claim links (takes precedence over draft handle)
        const queryHandle = new URLSearchParams(window.location.search).get("handle")?.trim().toLowerCase();
        if (queryHandle && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(queryHandle)) {
          setHandle(queryHandle);
          setNoindex(undefined);
          setProtectedSite(undefined);
          setSavedPasscodeSlug("");
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
          ownerEmail: user?.email ?? draftOwnerRef.current,
          resumeText,
          stylePrompt,
          theme,
          handle,
          generated,
          hasGenerated,
          noindex, protectedSite, savedPasscodeSlug,
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
    user?.email,
    noindex, protectedSite, savedPasscodeSlug,
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

  const loadExistingSite = async (slug: string) => {
    setLoadingSiteSlug(slug);
    setPublishError(null);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(slug)}?edit=1`);
      const data = (await res.json()) as {
        profile?: PortfolioProfile;
        externalOrigin?: string;
        expiresAt?: string;
        privacy?: { noindex: boolean; protected: boolean };
        aiBrief?: AiBrief;
        chatMeta?: ChatMeta;
        error?: string;
      };
      if (!res.ok || !data.profile) throw new Error(data.error || "Could not load site.");
      setExternalMountOrigin(data.externalOrigin || null);
      setGenerated(data.profile);
      setHasGenerated(true);
      setTheme(data.profile.theme || "editorial");
      setStylePrompt(data.profile.stylePrompt || data.profile.ai?.stylePrompt || "");
      setHandle(slug);
      setBriefDraft({ owner: user?.email, slug, values: data.aiBrief ?? {} });
      setPublishedProfile(data.profile);
      setPublishedUrl(`${window.location.origin}/u/${slug}`);
      setPublishedExpires(data.expiresAt ? data.expiresAt.slice(0, 10) : null);
      setNoindex(Boolean(data.privacy?.noindex));
      setProtectedSite(Boolean(data.privacy?.protected));
      setSavedPasscodeSlug(data.privacy?.protected ? slug : "");
      setPasscode("");
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

  const deleteSite = async (slug: string) => {
    const message = lang === "zh" ? `确认下线 /u/${slug}？该链接将失效，并释放一个站点名额。` : `Take /u/${slug} offline? Its link will stop working and a site slot will be freed.`;
    if (!window.confirm(message)) return;
    setLoadingSiteSlug(slug);
    setSiteActionError("");
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const { sites } = await res.json();
      setUser((previous) => previous && { ...previous, sites });
      if (publishedUrl?.endsWith(`/u/${slug}`)) {
        setBriefDraft(undefined);
        setPublishedUrl(null);
        setPublishedExpires(null);
        setExternalMountOrigin(null);
      }
    } catch {
      setSiteActionError(lang === "zh" ? "未能下线站点，请刷新后重试。" : "Could not remove the site. Refresh and try again.");
    } finally {
      setLoadingSiteSlug(null);
    }
  };

  function authenticated(account: AuthUser) {
    if (draftOwnerRef.current && draftOwnerRef.current !== account.email) {
      resetDraft();
    }
    draftOwnerRef.current = account.email;
    setUser(account);
    setPendingRefCode("");
    setAuthModalOpen(false);
    setAuthIntent(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("ref")) {
      url.searchParams.delete("ref");
      window.history.replaceState(null, "", url);
    }
    if (pendingCheckout) {
      setPendingCheckout(undefined);
      window.history.replaceState(null, "", window.location.pathname);
      void startPlanCheckout(pendingCheckout.tier, pendingCheckout.interval);
    } else if (authIntent === "generate") void generateProfile(account, true);
    else if (authIntent === "publish") void publishLiveSite(account);
  }

  const closeAuth = () => {
    setAuthModalOpen(false);
    setAuthIntent(null);
    if (pendingCheckout) {
      setPendingCheckout(undefined);
      window.history.replaceState(null, "", window.location.pathname);
    }
  };

  const logout = async () => {
    draftOwnerRef.current = undefined;
    resetDraft();
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

    const isImage = ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp";
    if (isImage) {
      if (!user) {
        setError(lang === "zh" ? "请先邮箱登录后再上传简历图片自动识别。" : "Please sign in first to extract text from résumé images.");
        setAuthModalOpen(true);
        return;
      }
      setUploadingFile(true);
      try {
        const imageDataUrl = await resizeResumeImageForOcr(file);
        const res = await fetch("/api/parse-resume-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageDataUrl, fileName: name }),
        });
        const data = (await res.json().catch(() => ({}))) as { text?: string; chars?: number; error?: string };
        if (!res.ok || !data.text) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setResumeText(data.text.slice(0, 14000));
        setUploadNote(
          lang === "zh"
            ? `已从简历图片识别 ${data.chars ?? data.text.length} 字（${name}）`
            : `Extracted ${data.chars ?? data.text.length} chars from ${name}`,
        );
      } catch (err) {
        setError(localizeApiError(err instanceof Error ? err.message : "Image OCR failed.", lang));
      } finally {
        setUploadingFile(false);
      }
      return;
    }

    if (ext !== "pdf" && ext !== "docx") {
      setError(
        lang === "zh"
          ? "不支持该文件格式，请上传 .pdf、.docx、简历截图（.png/.jpg/.webp）、.md、.txt 或 .json。"
          : "Unsupported format. Please upload .pdf, .docx, image (.png/.jpg/.webp), .md, .txt, or .json.",
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

  const generateProfile = async (account: AuthUser | null, keepDraftSettings = false) => {
    setError(null);
    setLoading(true);
    const useGuestTrial = !account && genMode === "hosted";
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
          ...(useGuestTrial ? { guestTrial: true } : {}),
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
        credits?: CreditBalance;
        guestTrialUsed?: boolean;
        guestTrialExhausted?: boolean;
        error?: string;
      };
      if (account) updateCredits(account.email, data.credits);
      if (res.status === 401 && useGuestTrial) {
        try { window.localStorage.setItem("talkcv-guest-trial-used", "1"); } catch {}
        setAuthIntent("generate");
        setAuthModalOpen(true);
        return;
      }
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Generation failed.");
      }
      if (data.guestTrialUsed) {
        try { window.localStorage.setItem("talkcv-guest-trial-used", "1"); } catch {}
        setBillingBanner(
          lang === "zh"
            ? "🎉 已免登录为你生成预览草稿！可自由点击修改文字或切换皮肤，点击「发布 / 更新专属链接」验证邮箱即可永久绑定并上线。"
            : "🎉 Preview draft generated! Click any text to edit or switch skins, then click Publish to verify your email and go live.",
        );
      }
      setGenerated(data.profile);
      setHasGenerated(true);
      setPublishedUrl(null);
      const suggested = data.profile.basics.name.en
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      if (suggested.length >= 3 && (!keepDraftSettings || handle === DEFAULT_HANDLE)) setHandle(suggested);
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
    if (externalMountOrigin && handle.trim()) {
      window.open(`/u/${encodeURIComponent(normalizeSlug(handle))}`, "_blank", "noopener,noreferrer");
      return;
    }
    window.localStorage.setItem(
      "talkcv-draft-profile",
      JSON.stringify({ ...generated, theme }),
    );
    const publishedSlug = publishedUrl?.match(/\/u\/([^/?#]+)/)?.[1] ?? "";
    const query = publishedSlug
      ? `handle=${encodeURIComponent(publishedSlug)}&lang=${lang}`
      : `lang=${lang}`;
    window.open(`/preview?${query}`, "_blank", "noopener,noreferrer");
  };

  const publishLiveSite = async (account: AuthUser) => {
    setPublishError(null);
    if (protectedSite && (passcode || savedPasscodeSlug !== normalizeSlug(handle)) && !/^[A-Za-z0-9]{4,8}$/.test(passcode)) {
      setPublishError(lang === "zh" ? "请输入 4 到 8 位字母或数字作为口令。" : "Enter a passcode of 4 to 8 letters or digits.");
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: handle,
          aiBrief,
          privacy: { noindex, protected: protectedSite, passcode: protectedSite && passcode ? passcode : undefined },
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
        privacy?: { noindex: boolean; protected: boolean };
        chatMeta?: ChatMeta;
        referralReward?: { credits: number; trialDays: number; inviterRewarded?: boolean };
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Publish failed.");
      }
      if (data.slug) setHandle(data.slug);
      if (aiBrief && data.slug) setBriefDraft({ owner: account.email, slug: data.slug, values: aiBrief });
      setPublishedProfile(generated);
      setPublishedUrl(data.url);
      setNoindex(Boolean(data.privacy?.noindex));
      setProtectedSite(Boolean(data.privacy?.protected));
      setSavedPasscodeSlug(data.privacy?.protected ? data.slug ?? handle : "");
      setPasscode("");
      setPublishedExpires(data.expiresAt ? data.expiresAt.slice(0, 10) : null);
      if (data.chatMeta) {
        setSavedByokMask(data.chatMeta.hasByokKey ? data.chatMeta.byokKeyMask : "");
        setChatByokApiKey("");
        setClearByokKey(false);
      }
      if (data.referralReward) {
        const r = data.referralReward;
        setBillingBanner(
          lang === "zh"
            ? r.inviterRewarded !== false
              ? `🎁 好友邀请奖励已发放！你已解锁 ${r.trialDays} 天 Pro 体验（+${r.credits} 奖励点），好友获得 +${REFERRAL_CREDITS.inviter} 点及 7 天 Pro 体验。`
              : `🎁 好友邀请奖励已发放！你已解锁 ${r.trialDays} 天 Pro 体验（+${r.credits} 奖励点）！`
            : r.inviterRewarded !== false
              ? `🎁 Referral reward unlocked! You received ${r.trialDays}-day Pro trial (+${r.credits} bonus credits), and your friend earned ${REFERRAL_CREDITS.inviter} credits and 7 days of Pro.`
              : `🎁 Referral reward unlocked! You received ${r.trialDays}-day Pro trial (+${r.credits} bonus credits)!`,
        );
        fetch("/api/auth/me")
          .then((resp) => (resp.ok ? resp.json() : null))
          .then((me: { user?: AuthUser | null } | null) => {
            const updated = me?.user;
            if (updated?.email === account.email) setUser((current) => current?.email === account.email ? updated : current);
          })
          .catch(() => {});
      } else if (data.slug) {
        const slug = data.slug;
        setUser((current) => current?.email === account.email && !current.sites.includes(slug)
          ? { ...current, sites: [...current.sites, slug] } : current);
      }
    } catch (err) {
      setPublishError(localizeApiError(err instanceof Error ? err.message : "Publish failed.", lang));
    } finally {
      setPublishing(false);
    }
  };

  function startDraftAction(action: "generate" | "publish") {
    if (!user) {
      if (action === "generate" && genMode === "hosted") {
        let alreadyUsed = false;
        try { alreadyUsed = window.localStorage.getItem("talkcv-guest-trial-used") === "1"; } catch {}
        if (!alreadyUsed) {
          void generateProfile(null);
          return;
        }
      }
      if (action === "generate" && genMode === "byok" && genApiKey.trim()) {
        void generateProfile(null);
        return;
      }
      setAuthIntent(action);
      setAuthModalOpen(true);
    } else if (action === "generate") void generateProfile(user);
    else void publishLiveSite(user);
  }

  const selectedSite = user?.sites.find((slug) => publishedUrl?.endsWith(`/u/${slug}`))
    ?? user?.sites.find((slug) => slug === normalizeSlug(handle)) ?? user?.sites[0];
  const remaining = user?.credits.remaining ?? PLAN_CREDITS.free;
  const balanceLabel = lang === "zh" ? `剩余 ${remaining} 点` : `${remaining} credits left`;
  const tailorSiteForJd = async () => {
    const jd = jdTailorText.trim();
    if (!jd) return;
    if (!user && genMode !== "byok") {
      setAuthModalOpen(true);
      return;
    }
    const canAiEdit = Boolean(user?.isPro) || (genMode === "byok" && Boolean(genApiKey.trim()));
    if (!canAiEdit) {
      setPricingOpen(true);
      return;
    }
    setJdTailorLoading(true);
    setJdTailorError(null);
    setJdTailorNote(null);
    try {
      const instruction =
        lang === "zh"
          ? `请针对下方目标岗位 JD 定制这份个人简历站点：
1) 重排 projects[]，把与目标 JD 最相关的项目放到最前面。
2) 把与 JD 匹配的技能移到 skills[] 前排。
3) 优化 basics.headline、basics.intro 和项目摘要，突出与目标岗位的真实契合点。
4) 严格保持事实真实：绝不编造简历中不存在的技能、公司、项目或指标，并同步保持中英文双语字段一致。

目标岗位 JD：
${jd.slice(0, 3000)}`
          : `Tailor this portfolio specifically for the target JD below:
1) Reorder projects[] so the most relevant project for this JD is first.
2) Move matching skills to the front of skills[].
3) Sharpen basics.headline, basics.intro, and project summaries to emphasize genuine alignment with the JD.
4) STRICT FACTUAL FIDELITY: NEVER invent any skills, employers, projects, or metrics not already present in the profile. Keep both en and zh synced.

Target JD:
${jd.slice(0, 3000)}`;
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: generated,
          theme,
          lang,
          instruction,
          providerMode: genMode,
          hostedModelId: genModelId,
          ...(genMode === "byok" ? { apiKey: genApiKey, baseUrl: genBaseUrl, model: genModel } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        profile?: PortfolioProfile;
        summary?: string;
        credits?: CreditBalance;
        error?: string;
      };
      if (!res.ok || !json.profile) {
        if (res.status === 402 || res.status === 403) setPricingOpen(true);
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (json.credits) updateCredits(user?.email, json.credits);
      setGenerated(json.profile);
      setHasGenerated(true);
      const cleanSuffix = normalizeSlug(jdTailorSuffix);
      if (cleanSuffix) {
        const base = normalizeSlug(handle || generated.basics.name.en || "cv").replace(new RegExp(`-${cleanSuffix}$`), "");
        setHandle(normalizeSlug(`${base}-${cleanSuffix}`));
      }
      setJdTailorNote(
        json.summary ||
          (lang === "zh"
            ? "已按目标 JD 完成亮点重排与定制，点击上方「发布」即可生成专属定制链接！"
            : "Portfolio tailored to the target JD. Click Publish to launch your targeted link!"),
      );
    } catch (err) {
      setJdTailorError(localizeApiError(err instanceof Error ? err.message : "JD tailoring failed.", lang));
    } finally {
      setJdTailorLoading(false);
    }
  };

  const generateCustomWebPage = async (isRefine = false) => {
    if (!user && genMode !== "byok") {
      setAuthModalOpen(true);
      return;
    }
    const promptToUse = stylePrompt.trim() || STYLE_PRESETS[0].prompt;
    if (isRefine && !customRefineInput.trim()) return;
    setCustomGenLoading(true);
    setCustomGenError(null);
    try {
      const res = await fetch("/api/generate-custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: generated,
          stylePrompt: promptToUse,
          lang,
          ...(isRefine && generated.customHtml
            ? { currentHtml: generated.customHtml, instruction: customRefineInput.trim() }
            : {}),
          providerMode: genMode,
          hostedModelId: genModelId,
          ...(genMode === "byok" ? { apiKey: genApiKey, baseUrl: genBaseUrl, model: genModel } : {}),
        }),
      });
      const text = await res.text();
      let json: { html?: string; credits?: CreditBalance; error?: string } = {};
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok || !json.html) {
        if (res.status === 402 || res.status === 403) setPricingOpen(true);
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (json.credits) updateCredits(user?.email, json.credits);
      setGenerated((prev) => ({ ...prev, renderMode: "custom", customHtml: json.html }));
      setHasGenerated(true);
      if (isRefine) setCustomRefineInput("");
    } catch (err) {
      setCustomGenError(localizeApiError(err instanceof Error ? err.message : "Failed to generate custom page.", lang));
    } finally {
      setCustomGenLoading(false);
    }
  };

  const previewStyleVars = designTokensToCssVars(generated.designTokens, theme) as React.CSSProperties;

  return (
    <main className="af-create-page">
      <PromoTopBanner lang={lang} />
      <header className="af-header">
        <Link className="af-brand" href="/">
          <span className="af-brand-mark">TC</span>
          <strong>TalkCV Studio</strong>
        </Link>
        <div className="af-header-controls">
          <OnboardingTour key={user?.email ?? "guest"} email={user?.email} lang={lang}
            blocked={authModalOpen || pricingOpen || redeemModalOpen || loading || publishing || Boolean(checkoutBusyTier)} />
          {user ? (
            <>
              <div className="af-user-pill">
                <User size={13} />
                <span>{user.email}</span>
                {user.isPro && (
                  <em style={{ background: "var(--accent)", color: "var(--accent-ink)", padding: "1px 6px", borderRadius: 999 }}>
                    {user.isMax ? "MAX" : user.isTrial ? "PRO 体验" : "PRO"}
                  </em>
                )}
                <em>
                  {balanceLabel}
                </em>
                <button type="button" onClick={logout} title={lang === "zh" ? "退出登录" : "Sign out"}>
                  <LogOut size={12} />
                </button>
              </div>
              {user.isPro && !user.isTrial && user.hasBillingPortal && (
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
                  <span>
                    {lang === "zh"
                      ? user.isTrial
                        ? "升级正式 Pro"
                        : user.isPro
                          ? "升级 Max"
                          : "升级会员"
                      : user.isTrial
                        ? "Upgrade Pro"
                        : user.isPro
                          ? "Upgrade Max"
                          : "Upgrade"}
                  </span>
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
              <span>{lang === "zh" ? "邮箱登录（赠 30 点）" : "Sign in with Email"}</span>
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

      {!user && pendingRefCode && (
        <div className="af-shell af-mysites-bar" role="status">
          <Sparkles size={14} />
          <span>
            {lang === "zh"
              ? `🎁 好友邀请码为 ${pendingRefCode}。登录并发布首个个人站后，你立得 3 天 Pro 体验（+${REFERRAL_CREDITS.invitee} 点），好友同获 ${REFERRAL_CREDITS.inviter} 点及 7 天体验！`
              : `🎁 Sign in with invite code ${pendingRefCode} and publish your first site to unlock a 3-day Pro trial (+${REFERRAL_CREDITS.invitee} credits) for you and ${REFERRAL_CREDITS.inviter} credits plus 7 days for your friend!`}
          </span>
          <button type="button" className="af-icon-pill af-login-pill" onClick={() => setAuthModalOpen(true)}>
            {lang === "zh" ? "立即登录领取" : "Sign in to claim"}
          </button>
        </div>
      )}

      {user?.referral && (
        <div id="studio-referral" className="af-shell af-mysites-bar">
          <span className="af-mysites-label">
            <Sparkles size={13} />{" "}
            {lang === "zh"
              ? `好友首次发布简历站后，你得 +${REFERRAL_CREDITS.inviter} 点及 7 天 Pro 体验，好友得 +${REFERRAL_CREDITS.invitee} 点及 3 天 Pro 体验（已邀 ${user.referral.invitedCount}/${user.referral.maxRewards} 人）`
              : `Earn ${REFERRAL_CREDITS.inviter} credits and 7 days of Pro when a friend first publishes. They get ${REFERRAL_CREDITS.invitee} credits & 3 days of Pro (${user.referral.invitedCount}/${user.referral.maxRewards} invited)`}
          </span>
          <button
            type="button"
            className="af-icon-pill af-login-pill"
            onClick={() => {
              const link = `${window.location.origin}/create?ref=${user.referral!.code}`;
              void navigator.clipboard?.writeText(link);
              setCopiedRef(true);
              window.setTimeout(() => setCopiedRef(false), 2000);
            }}
          >
            {copiedRef ? <Check size={12} /> : <Copy size={12} />}
            <span>
              {copiedRef
                ? lang === "zh"
                  ? "已复制邀请链接"
                  : "Invite link copied"
                : lang === "zh"
                  ? `复制专属邀请链接 (${user.referral.code})`
                  : `Copy invite link (${user.referral.code})`}
            </span>
          </button>
        </div>
      )}

      {billingBanner && (
        <div className="af-shell af-mysites-bar" role="status">
          <Sparkles size={14} />
          <span>{billingBanner}</span>
          <button type="button" className="af-inline-link" onClick={() => setBillingBanner(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {user && (
        <section className="af-shell af-mysites-bar">
          <span className="af-mysites-label">
            <Globe size={13} /> {lang === "zh" ? "我的已发布站点" : "My published sites"}
            <span>{lang === "zh" ? `剩余 ${Math.max(0, user.maxSites - user.sites.length)}/${user.maxSites} 个名额` : `${Math.max(0, user.maxSites - user.sites.length)}/${user.maxSites} slots available`}</span>
          </span>
          <div className="af-mysites-list">
            {user.sites.map((slug) => (
              <div className="af-site-entry" key={slug}>
                <button type="button" className={`af-icon-pill ${publishedUrl?.endsWith(`/u/${slug}`) ? "af-site-active" : ""}`}
                  disabled={loadingSiteSlug !== null} onClick={() => void loadExistingSite(slug)}>/u/{slug}</button>
                <button
                  type="button"
                  className="af-site-delete"
                  disabled={loadingSiteSlug !== null}
                  title={lang === "zh" ? `下线并删除 /u/${slug}` : `Delete /u/${slug}`}
                  aria-label={`${lang === "zh" ? "下线" : "Delete"} /u/${slug}`}
                  onClick={() => void deleteSite(slug)}
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {user.sites.length > 0 && (
              <button
                type="button"
                className="af-icon-pill"
                onClick={() => {
                  if (user.sites.length >= user.maxSites) {
                    setSiteActionError(
                      lang === "zh"
                        ? `当前套餐最多支持 ${user.maxSites} 个站点，请先升级套餐或删除旧站点后再克隆新版本。`
                        : `Your plan allows up to ${user.maxSites} sites. Upgrade or delete an old site before cloning.`,
                    );
                    setPricingOpen(true);
                    return;
                  }
                  const orig = normalizeSlug(handle || user.sites[0] || "my-site").replace(/-v\d+$/, "");
                  let ver = 2;
                  let candidate = `${orig}-v${ver}`;
                  while (user.sites.includes(candidate) && ver < 20) {
                    ver += 1;
                    candidate = `${orig}-v${ver}`;
                  }
                  setSiteActionError("");
                  setExternalMountOrigin(null);
                  setHandle(candidate);
                  setPublishedUrl(null);
                  setProtectedSite(false);
                  setSavedPasscodeSlug("");
                  setPasscode("");
                  setCloneNotice(
                    lang === "zh"
                      ? `正在创建新分身站点 /u/${candidate}，不会覆盖原链接 /u/${orig}。修改内容后点击发布即可上线。`
                      : `Cloning as new variant /u/${candidate} without overwriting /u/${orig}. Edit and publish when ready.`,
                  );
                  window.requestAnimationFrame(() => handleInputRef.current?.focus());
                }}
              >
                <Copy size={12} />
                <span>{lang === "zh" ? "克隆为新岗位版本" : "Clone as new variant"}</span>
              </button>
            )}
          </div>
          {cloneNotice && <p role="status" style={{ margin: "6px 0 0", fontSize: 12.5, color: "#0071e3" }}>{cloneNotice}</p>}
          {siteActionError && <p role="alert">{siteActionError}</p>}
        </section>
      )}

      {user && selectedSite && <SiteInsights key={`${user.email}:${selectedSite}:${currentPlan}`} slug={selectedSite}
        lang={lang} onUpgrade={() => setPricingOpen(true)} />}

      <div className="af-shell">
        <PromoAnnouncementCard
          lang={lang}
          activeModelId={genModelId}
          onPickAstra={() => {
            setGenModelId("gpt-6.2-astra");
            setChatHostedModelId("gpt-6.2-astra");
          }}
        />
      </div>

      <div className="af-shell af-create-grid">
        {externalMountOrigin ? (
          <section className="af-create-panel" aria-label={lang === "zh" ? "外部独立站代托管模式" : "External standalone site mode"}>
            <div className="af-panel-top">
              <p className="af-eyebrow">EXTERNAL MOUNT · PROXY HOSTING</p>
              <button
                type="button"
                className="af-reset-link"
                onClick={() => {
                  setExternalMountOrigin(null);
                  setPublishedUrl(null);
                  setHandle(DEFAULT_HANDLE);
                }}
              >
                <RotateCcw size={12} /> {lang === "zh" ? "新建普通站点" : "New TalkCV site"}
              </button>
            </div>
            <h1>{lang === "zh" ? "外部独立站代托管模式" : "External Standalone Site Mount"}</h1>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--muted)", margin: "0 0 14px" }}>
              {lang === "zh"
                ? `当前站点 /u/${handle} 已通过代理挂载到你的独立部署作品集，右侧实时展示线上原版页面。无需在左侧选皮肤或重新生成，避免误覆盖原版独立站。`
                : `Your site /u/${handle} proxies your standalone portfolio directly. The right pane shows the real live site so you won't accidentally overwrite it with a template.`}
            </p>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--surface-alt)",
                border: "1px solid var(--line)",
                fontSize: 12.5,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginBottom: 14,
              }}
            >
              <div>
                <strong>{lang === "zh" ? "对外访问链接：" : "Public URL:"}</strong>{" "}
                <code>/u/{handle}</code>
              </div>
              <div>
                <strong>{lang === "zh" ? "挂载源站地址：" : "Upstream origin:"}</strong>{" "}
                <code>{externalMountOrigin}</code>
              </div>
            </div>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 16px" }}>
              {lang === "zh"
                ? "✅ 你仍可在顶部与右侧正常使用：访客洞察、约面线索、访问口令锁、禁止搜索引擎收录、分享海报与给原版 PDF 盖 AI 二维码。"
                : "✅ Visitor insights, recruiter leads, passcode lock, noindex, share poster, and PDF QR stamper all continue to work normally."}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a
                href={`/u/${encodeURIComponent(handle)}`}
                target="_blank"
                rel="noreferrer"
                className="af-btn af-btn-primary"
              >
                <ExternalLink size={14} />
                <span>{lang === "zh" ? "新窗口打开原版站" : "Open live site"}</span>
              </a>
              <button
                type="button"
                className="af-btn af-btn-secondary"
                onClick={() => {
                  setExternalMountOrigin(null);
                  setPublishedUrl(null);
                  setHandle(DEFAULT_HANDLE);
                }}
              >
                <span>{lang === "zh" ? "切回创建新简历站" : "Create another site"}</span>
              </button>
            </div>
          </section>
        ) : (
        <form className="af-create-panel" onSubmit={(e) => { e.preventDefault(); startDraftAction("generate"); }}>
          <div className="af-panel-top">
            <p className="af-eyebrow">STEP 1 · GENERATE</p>
            {hasGenerated && (
              <button type="button" className="af-reset-link" onClick={resetDraft}>
                <RotateCcw size={12} /> {lang === "zh" ? "清空草稿" : "Reset draft"}
              </button>
            )}
          </div>
          <h1>{lang === "zh" ? "把简历变成会说话的网站" : "Turn your resume into a site that talks back"}</h1>

          <div className="af-tour-group" data-tour="upload">
            <div className="af-field-label">
              <label htmlFor="studio-resume-text">{lang === "zh" ? "1. 简历内容" : "1. Resume content"}</label>
              <label className="af-upload-btn">
                <FileUp size={13} />
                <span>
                  {uploadingFile
                    ? lang === "zh"
                      ? "解析文件中…"
                      : "Parsing…"
                    : lang === "zh"
                      ? "上传 PDF / Word / 截图图片 / MD"
                      : "Upload PDF / DOCX / Image / MD"}
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.md,.txt,.json,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  onChange={onFileUpload}
                  disabled={uploadingFile}
                  hidden
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <button
                type="button"
                className="af-icon-pill"
                onClick={() => {
                  setResumeText(lang === "zh" ? SAMPLE_TRIAL_RESUME_ZH : SAMPLE_TRIAL_RESUME_EN);
                  setUploadNote(lang === "zh" ? "已填入示例简历，直接点下方按钮即可体验生成！" : "Sample résumé filled — click Generate below to try!");
                }}
              >
                <Sparkles size={12} />
                <span>{lang === "zh" ? "填入示例简历试玩" : "Try sample résumé"}</span>
              </button>
              <button
                type="button"
                className="af-icon-pill"
                onClick={() => {
                  const scrubbed = resumeText
                    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, lang === "zh" ? "[已隐藏手机号]" : "[REDACTED-PHONE]")
                    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "contact@example.com");
                  setResumeText(scrubbed);
                  setUploadNote(
                    lang === "zh"
                      ? "已在浏览器本地抹除手机号与私人邮箱，不会发送给服务器。"
                      : "Phone numbers & personal emails scrubbed locally in your browser.",
                  );
                }}
              >
                <Lock size={12} />
                <span>{lang === "zh" ? "本地抹除手机号/私人邮箱" : "Scrub phone/email locally"}</span>
              </button>
            </div>
            {uploadNote && (
              <div className="af-quota-note" style={{ marginBottom: 6 }}>
                ✓ {uploadNote}
              </div>
            )}
            <textarea
              id="studio-resume-text" className="af-textarea"
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
            <div className="af-quota-note" style={{ marginTop: 6 }}>
              {lang === "zh"
                ? "🔒 隐私可控：支持禁止搜索引擎收录与访问口令 · 随时一键彻底删除 · 核心渲染引擎 GitHub 开源可审计"
                : "🔒 Privacy first: Search-engine opt-out & passcode lock · Instant deletion anytime · Open-source rendering engine on GitHub"}
            </div>
          </div>

          <div className="af-field-label">
            <span>
              <Wand2 size={13} /> {lang === "zh" ? "2. 选择视觉风格（点一下右侧实时换肤）" : "2. Pick a style preset (instant preview)"}
            </span>
          </div>
          <div className="af-preset-row">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={stylePrompt === preset.prompt ? "active" : ""}
                onClick={() => {
                  setStylePrompt(preset.prompt);
                  setTheme(preset.theme);
                  setGenerated((prev) => ({
                    ...prev,
                    theme: preset.theme,
                    stylePrompt: preset.prompt,
                    designTokens: { ...preset.designTokens },
                    layoutPlan: { ...prev.layoutPlan, ...preset.layoutPlan },
                  }));
                }}
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
                ? "可选：补充一句自定义风格或人设要求（如：重点突出高并发指标、黑金画册感…）"
                : "Optional: add custom style or tone direction…"
            }
          />

          <details className="af-advanced-drawer">
            <summary>
              <span>
                ⚙️ {lang === "zh" ? "高级设置（模型 / 基础主题 / 自带 Key）" : "Advanced settings (Model / Theme / BYOK)"}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
                {genMode === "byok" ? `BYOK · ${genModel}` : genModelId}
              </span>
            </summary>
            <div className="af-advanced-drawer-body">
              <div className="af-field-label">
                <span>
                  <Palette size={13} /> {lang === "zh" ? "基础布局主题" : "Base theme"}
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
                  <KeyRound size={13} /> {lang === "zh" ? "简历生成模型" : "Resume generation model"}
                </span>
              </div>
          <div className="af-preset-row">
            <button
              type="button"
              className={genMode === "hosted" ? "active" : ""}
              onClick={() => setGenMode("hosted")}
            >
              {lang === "zh" ? "TalkCV 托管点数" : "TalkCV hosted credits"}
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
                      : isPromoUnlockedModel(m)
                        ? lang === "zh"
                          ? "· 🎁 限时免费"
                          : "· 🎁 Free Promo"
                        : canUseModel(m.id, currentPlan)
                          ? `★ ${m.tier.toUpperCase()}`
                          : `🔒 ${m.tier.toUpperCase()}`}
                  </option>
                ))}
              </select>
              <div className="af-quota-note">
                {user ? (
                  <span>
                    {user.email} · {balanceLabel}
                  </span>
                ) : (
                  <button type="button" className="af-inline-link" onClick={() => setAuthModalOpen(true)}>
                    {lang === "zh"
                      ? "邮箱登录后领取 30 点终身体验点数"
                      : "Sign in for 30 lifetime credits"}
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
            </div>
          </details>

          {error && <div className="af-ai-error">{error}</div>}

          <button type="submit" className="af-btn af-btn-primary af-create-submit" disabled={loading || uploadingFile}>
            <Sparkles size={16} />
            <span>
              {loading
                ? lang === "zh"
                  ? "正在解析简历并定制风格…"
                  : "Generating your TalkCV…"
                : lang === "zh"
                  ? "开始生成简历网站"
                  : "Generate résumé site"} · {creditCostLabel(CREDIT_COST.generate, lang, genMode === "byok")}
            </span>
          </button>
        </form>
        )}

        <section className="af-preview-panel">
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
              <PdfResumeBuilder
                profile={generated}
                slug={(publishedUrl ? new URL(publishedUrl).pathname.split("/").pop() : undefined) || normalizeSlug(handle) || undefined}
                lang={lang}
                currentPlan={currentPlan}
                providerMode={genMode}
                hostedModelId={genModelId}
                apiKey={genApiKey}
                baseUrl={genBaseUrl}
                byokModel={genModel}
                isSignedIn={Boolean(user)}
                onRequireAuth={() => setAuthModalOpen(true)}
                onRequirePricing={() => setPricingOpen(true)}
                onCredits={(c) => updateCredits(user?.email, c)}
                triggerLabel={lang === "zh" ? "AI 重排 PDF" : "AI PDF"}
              />
            </div>
          </div>

          <div className="af-publish-box">
            <div className="af-publish-row" data-tour="publish">
              <div className="af-handle-input">
                <span>/u/</span>
                <input
                  ref={handleInputRef}
                  type="text"
                  value={handle}
                  onChange={(e) => {
                    const next = e.target.value;
                    setHandle(next);
                    // A stored public setting belongs to its original handle.
                    // Omitted settings preserve the target site's privacy on the server.
                    if (noindex === false) setNoindex(undefined);
                    if (protectedSite === false) setProtectedSite(undefined);
                  }}
                  placeholder="your-name"
                  aria-label="Custom handle"
                />
              </div>
              <button
                type="button"
                className="af-btn af-btn-primary af-publish-btn"
                disabled={publishing}
                onClick={() => startDraftAction("publish")}
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

            <details className="af-advanced-drawer" style={{ margin: "10px 0 6px" }}>
              <summary>
                <span>
                  <Lock size={12} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                  {lang === "zh" ? "发布与访客 AI 设置（模型 · 口令隐私 · AI 回答边界 · 白标）" : "Publish & Visitor AI settings (Model · Privacy · Brief · White-label)"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
                  {chatMode === "byok" ? "BYOK" : chatHostedModelId}
                </span>
              </summary>
              <div className="af-advanced-drawer-body">
            <div className="af-field-label">
              <span>
                <Lock size={13} /> {lang === "zh" ? "配置发布后的访客 AI 对话模型" : "Visitor AI Chat Model (for your live site)"}
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
                      : isPromoUnlockedModel(m)
                        ? lang === "zh"
                          ? "· 🎁 限时免费"
                          : "· 🎁 Free Promo"
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

            <div className="af-tour-group" data-tour="privacy">
              <fieldset className="af-privacy-fields">
                <legend>{lang === "zh" ? "发布隐私" : "Publishing privacy"}</legend>
                <label><input type="checkbox" checked={noindex === true} onChange={(e) => setNoindex(e.target.checked)} />
                  {lang === "zh" ? "禁止搜索引擎收录" : "Exclude from search engines"}</label>
                <label><input type="checkbox" checked={protectedSite === true} onChange={(e) => { setProtectedSite(e.target.checked); setPasscode(""); }} />
                  {lang === "zh" ? "访问口令保护" : "Require a passcode"}</label>
                {protectedSite && <label className="af-field-label">
                  {savedPasscodeSlug === normalizeSlug(handle) ? (lang === "zh" ? "更换口令（留空保留现有口令）" : "New passcode (leave blank to keep current)") :
                    (lang === "zh" ? "设置口令（4 到 8 位字母或数字）" : "Set a passcode (4–8 letters or digits)")}
                  <input type="password" autoComplete="new-password" maxLength={8} value={passcode} onChange={(e) => setPasscode(e.target.value)} />
                </label>}
              </fieldset>
              <details className="af-brief" onToggle={(event) => { setBriefOpen(event.currentTarget.open); setBriefReadError(false); }}>
                <summary>{lang === "zh" ? "AI 回答边界与求职备忘" : "Private AI brief & answer boundaries"}</summary>
                <p>{lang === "zh" ? "备忘不展示在个人站。AI 可在访客提问时使用你授权的答案，遇到红线会请对方直接联系你。" :
                  "The brief stays off your public page. AI may share these answers with visitors and refers restricted topics to you."}</p>
                {!user ? <button type="button" className="af-icon-pill" onClick={() => setAuthModalOpen(true)}>{lang === "zh" ? "登录后设置" : "Sign in to edit"}</button> :
                  needsBrief ? <p role="status">{briefReadError ? (lang === "zh" ? "读取失败，请重新打开此面板。" : "Reopen this panel to retry.") :
                    (lang === "zh" ? "正在读取站点备忘…" : "Loading the site brief…")}</p> :
                  (Object.keys(BRIEF_LABELS) as (keyof AiBrief)[]).map((field) => {
                    const props = { maxLength: AI_BRIEF_LIMITS[field], value: aiBrief?.[field] ?? "",
                      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                        setBriefDraft({ owner: user.email, slug: existingBrief ? briefSlug : undefined,
                          values: { ...aiBrief, [field]: e.target.value } }) };
                    return <label key={field}>{BRIEF_LABELS[field][lang === "zh" ? 0 : 1]}
                      {field === "notes" || field === "redLines" ? <textarea rows={2} {...props} /> : <input {...props} />}
                    </label>;
                  })}
              </details>
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
              </div>
            </details>
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
                {publishedProfile && <SharePoster profile={publishedProfile} slug={new URL(publishedUrl).pathname.split("/").pop()!} lang={lang} />}
                <PdfQrStamper slug={new URL(publishedUrl).pathname.split("/").pop()!} lang={lang} />
                <PdfResumeBuilder
                  profile={publishedProfile ?? generated}
                  slug={new URL(publishedUrl).pathname.split("/").pop()!}
                  lang={lang}
                  currentPlan={currentPlan}
                  providerMode={genMode}
                  hostedModelId={genModelId}
                  apiKey={genApiKey}
                  baseUrl={genBaseUrl}
                  byokModel={genModel}
                  isSignedIn={Boolean(user)}
                  onRequireAuth={() => setAuthModalOpen(true)}
                  onRequirePricing={() => setPricingOpen(true)}
                  onCredits={(c) => updateCredits(user?.email, c)}
                  triggerLabel={lang === "zh" ? "AI 重排 A4 PDF" : "AI A4 PDF Résumé"}
                />
              </div>
            )}
          </div>

          {externalMountOrigin ? (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  🌐 {lang === "zh" ? `实时原版预览：/u/${handle}` : `Live standalone preview: /u/${handle}`}
                </span>
                <a
                  href={`/u/${encodeURIComponent(handle)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="af-icon-pill"
                >
                  <ExternalLink size={12} />
                  <span>{lang === "zh" ? "新窗口打开" : "Open in new tab"}</span>
                </a>
              </div>
              <iframe
                src={`/u/${encodeURIComponent(handle)}`}
                title={`/u/${handle}`}
                style={{
                  width: "100%",
                  height: 760,
                  border: "1px solid var(--line)",
                  borderRadius: 16,
                  background: "#ffffff",
                }}
              />
            </div>
          ) : (
          <>
          <div className="af-edit-toolbar" data-tour="preview">
            <span className="af-inline-edit-hint">
              ✏️ {lang === "zh" ? "所见即所得：点击下方任意文字或指标即可直接编辑" : "WYSIWYG: Click any text or metric below to edit inline"}
            </span>
            <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`af-icon-pill ${jdTailorOpen ? "af-login-pill" : ""}`}
                onClick={() => {
                  const canAiEdit = Boolean(user?.isPro) || (genMode === "byok" && Boolean(genApiKey.trim()));
                  if (!canAiEdit) {
                    setPricingOpen(true);
                    return;
                  }
                  setJdTailorOpen((prev) => !prev);
                }}
              >
                <Target size={13} />
                <span>
                  {lang === "zh" ? "按 JD 定制站点" : "Tailor to JD"} · {creditCostLabel(CREDIT_COST.edit, lang, genMode === "byok")}
                </span>
              </button>
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
                  {lang === "zh" ? "AI 实时精修" : "AI Live Refine"} · {creditCostLabel(CREDIT_COST.edit, lang, genMode === "byok")}
                </span>
              </button>
            </div>
          </div>

          {jdTailorOpen && (
            <div className="af-jd-tailor-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>
                  🎯 {lang === "zh" ? "按目标岗位 JD 一键派生定制简历站（严格不编造数据）" : "Tailor this résumé site to a target JD (strictly grounded)"}
                </strong>
                <button type="button" className="af-item-delete-btn" onClick={() => setJdTailorOpen(false)} aria-label="Close">
                  <X size={12} />
                </button>
              </div>
              <textarea
                rows={3}
                className="af-textarea"
                value={jdTailorText}
                onChange={(e) => setJdTailorText(e.target.value)}
                placeholder={lang === "zh" ? "粘贴目标岗位 JD（职位描述 / 任职要求）…" : "Paste target job description here…"}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                  <span>{lang === "zh" ? "专属短链后缀（可选）" : "Custom link suffix (optional)"}</span>
                  <input
                    type="text"
                    className="af-single-input"
                    style={{ width: 150, margin: 0, padding: "5px 10px" }}
                    value={jdTailorSuffix}
                    onChange={(e) => setJdTailorSuffix(e.target.value)}
                    placeholder={lang === "zh" ? "如 bytedance" : "e.g. stripe"}
                  />
                </label>
                <button
                  type="button"
                  className="af-btn af-btn-primary"
                  disabled={jdTailorLoading || !jdTailorText.trim()}
                  onClick={() => void tailorSiteForJd()}
                >
                  <Target size={13} />
                  <span>{jdTailorLoading ? (lang === "zh" ? "正在按 JD 定制…" : "Tailoring…") : (lang === "zh" ? "一键定制当前站 →" : "Tailor site now →")}</span>
                </button>
              </div>
              {jdTailorNote && <div className="af-quota-note">✓ {jdTailorNote}</div>}
              {jdTailorError && <div className="af-ai-error">{jdTailorError}</div>}
            </div>
          )}

          <OutreachPanel key={`${user?.email ?? ""}:${lang}`} lang={lang} signedIn={Boolean(user)}
            profile={hasGenerated ? generated : undefined} onCredits={(credits) => updateCredits(user?.email, credits)} onSignIn={() => setAuthModalOpen(true)}
            provider={{ providerMode: genMode, hostedModelId: genModelId,
              ...(genMode === "byok" && { apiKey: genApiKey, baseUrl: genBaseUrl, model: genModel }) }} />

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
              onCredits={(credits) => updateCredits(user?.email, credits)}
              onApplyProfile={(nextProfile) => {
                setGenerated(nextProfile);
                setHasGenerated(true);
                if (nextProfile.theme) setTheme(nextProfile.theme);
              }}
              onClose={() => setRefineOpen(false)}
            />
          )}

          <div style={{ padding: "10px 14px 0" }}>
            <div className="af-mode-switch" role="tablist" aria-label={lang === "zh" ? "页面渲染模式" : "Page render mode"}>
              <button
                type="button"
                role="tab"
                aria-selected={generated.renderMode !== "custom"}
                className={`af-mode-btn${generated.renderMode !== "custom" ? " active" : ""}`}
                onClick={() => setGenerated((prev) => ({ ...prev, renderMode: "structured" }))}
              >
                <strong>✨ {lang === "zh" ? "智能排版模式（推荐）" : "Smart Layout Mode"}</strong>
                <span>{lang === "zh" ? "支持点击改字、深度皮肤与 A4 PDF" : "Click-to-edit, deep skins & A4 PDF"}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={generated.renderMode === "custom"}
                className={`af-mode-btn${generated.renderMode === "custom" ? " active" : ""}`}
                onClick={() => setGenerated((prev) => ({ ...prev, renderMode: "custom" }))}
              >
                <strong>🎨 {lang === "zh" ? "自由创意网页模式" : "Custom AI Web Mode"}</strong>
                <span>{lang === "zh" ? "AI 按提示词手写整站（含悬浮 AI 助手）" : "AI crafts bespoke HTML/CSS + AI chat"}</span>
              </button>
            </div>
          </div>

          {generated.renderMode === "custom" ? (
            <div style={{ padding: "10px 14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="af-btn af-btn-primary"
                  disabled={customGenLoading}
                  onClick={() => void generateCustomWebPage(false)}
                >
                  <Wand2 size={14} />
                  <span>
                    {customGenLoading
                      ? lang === "zh"
                        ? "AI 正在手写整站网页…"
                        : "Generating bespoke web page…"
                      : generated.customHtml
                        ? lang === "zh"
                          ? `按当前风格重新生成 · ${creditCostLabel(CREDIT_COST.generate, lang, genMode === "byok")}`
                          : `Regenerate custom page · ${creditCostLabel(CREDIT_COST.generate, lang, genMode === "byok")}`
                        : lang === "zh"
                          ? `生成自由创意网页 · ${creditCostLabel(CREDIT_COST.generate, lang, genMode === "byok")}`
                          : `Generate custom web page · ${creditCostLabel(CREDIT_COST.generate, lang, genMode === "byok")}`}
                  </span>
                </button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {lang === "zh"
                    ? "左侧可一键点选 Apple 发布会 / 复古 Win95 / 黑金画册 等内置风格，或输入任意自定义描述"
                    : "Pick a built-in preset on the left or write any custom creative direction."}
                </span>
              </div>
              {generated.customHtml && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    className="af-single-input"
                    style={{ flex: 1, margin: 0 }}
                    value={customRefineInput}
                    onChange={(e) => setCustomRefineInput(e.target.value)}
                    placeholder={
                      lang === "zh"
                        ? "一句话继续微调创意网页（如：把标题再放大、背景改成深蓝星云…）"
                        : "Refine this custom page (e.g. make hero bolder, add subtle gold dividers…)"
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customRefineInput.trim() && !customGenLoading) {
                        e.preventDefault();
                        void generateCustomWebPage(true);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="af-btn af-btn-secondary"
                    disabled={customGenLoading || !customRefineInput.trim()}
                    onClick={() => void generateCustomWebPage(true)}
                  >
                    {lang === "zh"
                      ? `微调 · ${creditCostLabel(CREDIT_COST.edit, lang, genMode === "byok")}`
                      : `Refine · ${creditCostLabel(CREDIT_COST.edit, lang, genMode === "byok")}`}
                  </button>
                </div>
              )}
              {customGenError && <div className="af-ai-error">{customGenError}</div>}
              {generated.customHtml ? (
                <iframe
                  title="Custom AI portfolio preview"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={generated.customHtml}
                  style={{
                    width: "100%",
                    height: 620,
                    border: "1px solid var(--line)",
                    borderRadius: 14,
                    background: "#ffffff",
                  }}
                />
              ) : (
                <div
                  style={{
                    padding: "44px 20px",
                    textAlign: "center",
                    borderRadius: 14,
                    border: "1.5px dashed var(--line)",
                    color: "var(--muted)",
                    fontSize: 13,
                  }}
                >
                  {lang === "zh"
                    ? "先在左侧选一个内置风格（如 Apple 官网发布会风 / 复古 Win95 / 黑金建筑画册风）或写自定义风格，再点上方「生成自由创意网页」。"
                    : "Pick a built-in style preset on the left or write your own, then click Generate custom web page."}
                </div>
              )}
            </div>
          ) : (
          <>
          <div className="af-layout-bar" aria-label={lang === "zh" ? "个性化布局与排版" : "Layout & Typography"}>
            <label>
              <span>{lang === "zh" ? "首屏骨架" : "Hero"}</span>
              <select
                value={generated.layoutPlan?.heroStyle ?? "editorial-split"}
                onChange={(e) => {
                  const heroStyle = e.target.value as HeroStyle;
                  setGenerated((prev) => ({
                    ...prev,
                    layoutPlan: { ...prev.layoutPlan, heroStyle },
                  }));
                }}
              >
                {HERO_STYLE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{localize(opt.label, lang)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{lang === "zh" ? "项目排布" : "Projects"}</span>
              <select
                value={generated.layoutPlan?.projectLayout ?? "card-grid"}
                onChange={(e) => {
                  const projectLayout = e.target.value as ProjectLayout;
                  setGenerated((prev) => ({
                    ...prev,
                    layoutPlan: { ...prev.layoutPlan, projectLayout },
                  }));
                }}
              >
                {PROJECT_LAYOUT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{localize(opt.label, lang)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{lang === "zh" ? "字体气质" : "Font"}</span>
              <select
                value={generated.layoutPlan?.fontPair ?? "sans-modern"}
                onChange={(e) => {
                  const fontPair = e.target.value as FontPair;
                  setGenerated((prev) => ({
                    ...prev,
                    layoutPlan: { ...prev.layoutPlan, fontPair },
                  }));
                }}
              >
                {FONT_PAIR_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{localize(opt.label, lang)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{lang === "zh" ? "模块顺序" : "Order"}</span>
              <select
                value={(generated.layoutPlan?.sectionOrder ?? ["work", "capabilities", "experience", "contact"]).join(",")}
                onChange={(e) => {
                  const sectionOrder = e.target.value.split(",") as SectionId[];
                  setGenerated((prev) => ({
                    ...prev,
                    layoutPlan: { ...prev.layoutPlan, sectionOrder },
                  }));
                }}
              >
                <option value="work,capabilities,experience,contact">
                  {lang === "zh" ? "项目优先（工程师/产品）" : "Projects first"}
                </option>
                <option value="experience,work,capabilities,contact">
                  {lang === "zh" ? "教育与履历优先（应届生/行政）" : "Experience & Edu first"}
                </option>
                <option value="capabilities,work,experience,contact">
                  {lang === "zh" ? "核心能力优先（咨询/管理）" : "Capabilities first"}
                </option>
              </select>
            </label>
          </div>

          <div
            className="af-preview-canvas"
            data-theme={theme}
            style={previewStyleVars}
            data-font={generated.layoutPlan?.fontPair ?? "sans-modern"}
            data-bg-pattern={generated.designTokens?.bgPattern ?? "none"}
            data-card-style={generated.designTokens?.cardStyle ?? "elevated"}
            data-button-style={generated.designTokens?.buttonStyle ?? "pill"}
          >
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

            <ContactLinks basics={generated.basics} lang={lang} />
            <details className="af-contact-editor">
              <summary>{lang === "zh" ? "编辑联系方式" : "Edit contact details"}</summary>
              <div className="af-input-grid">
                {(["email", "github", "wechat", "linkedin", "portfolio"] as const).map((field) => (
                  <label key={field} className="af-field-label">
                    <span>{{ email: lang === "zh" ? "邮箱" : "Email", github: "GitHub", wechat: lang === "zh" ? "微信号" : "WeChat ID",
                      linkedin: "LinkedIn", portfolio: lang === "zh" ? "博客或作品集网址" : "Blog or portfolio URL" }[field]}</span>
                    <input type={field === "wechat" ? "text" : field === "email" ? "email" : "url"} value={generated.basics[field] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGenerated((previous) => ({ ...previous, basics: { ...previous.basics, [field]: value } }));
                        setHasGenerated(true);
                      }} />
                  </label>
                ))}
              </div>
            </details>

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
              {generated.projects.map((proj, pIdx) => (
                <article key={`${proj.slug}-${pIdx}`} className="af-card">
                  <div className="af-card-head-actions">
                    <div className="af-project-cover-upload" style={{ margin: 0 }}>
                      {proj.coverImage && (
                        <img src={proj.coverImage} alt="" className="af-project-cover-thumb" />
                      )}
                      <label className="af-icon-pill" style={{ cursor: "pointer" }}>
                        <ImagePlus size={12} />
                        <span>{proj.coverImage ? (lang === "zh" ? "更换项目截图" : "Replace cover") : (lang === "zh" ? "上传项目截图" : "Add screenshot")}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            try {
                              const dataUrl = await resizeImageToProjectCoverDataUrl(file);
                              setGenerated((prev) => ({
                                ...prev,
                                projects: prev.projects.map((item, idx) =>
                                  idx === pIdx ? { ...item, coverImage: dataUrl } : item,
                                ),
                              }));
                              setHasGenerated(true);
                            } catch {
                              // ignore invalid image
                            }
                          }}
                        />
                      </label>
                      {proj.coverImage && (
                        <button
                          type="button"
                          className="af-icon-pill"
                          onClick={() => {
                            setGenerated((prev) => ({
                              ...prev,
                              projects: prev.projects.map((item, idx) =>
                                idx === pIdx ? { ...item, coverImage: undefined } : item,
                              ),
                            }));
                            setHasGenerated(true);
                          }}
                        >
                          <X size={11} />
                          <span>{lang === "zh" ? "移除" : "Remove"}</span>
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="af-item-delete-btn"
                      title={lang === "zh" ? "删除此项目" : "Delete project"}
                      aria-label={lang === "zh" ? "删除此项目" : "Delete project"}
                      onClick={() => {
                        setGenerated((prev) => ({
                          ...prev,
                          projects: prev.projects.filter((_, idx) => idx !== pIdx),
                        }));
                        setHasGenerated(true);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
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
              <button
                type="button"
                className="af-add-item-btn"
                onClick={() => {
                  const idx = generated.projects.length + 1;
                  setGenerated((prev) => ({
                    ...prev,
                    projects: [
                      ...prev.projects,
                      {
                        slug: `project-${idx}-${Date.now().toString(36).slice(-4)}`,
                        accent: "blue",
                        group: "product",
                        category: { en: "Project", zh: "项目" },
                        title: { en: `New Project ${idx}`, zh: `新项目 ${idx}` },
                        role: { en: "Owner", zh: "项目负责人" },
                        summary: { en: "Click to describe your impact and technical highlights.", zh: "点击此处编辑项目简介与核心成果。" },
                        outcome: { en: "Delivered measurable results.", zh: "实现可量化业务成果。" },
                        tags: ["Highlight"],
                        facts: [{ value: "100%", label: { en: "Impact", zh: "核心指标" } }],
                        sections: [],
                        workflow: [],
                      },
                    ],
                  }));
                  setHasGenerated(true);
                }}
              >
                <Plus size={14} />
                <span>{lang === "zh" ? "添加一个新项目" : "Add a new project"}</span>
              </button>
            </div>

            <div className="af-studio-exp-section">
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.04em" }}>
                {lang === "zh" ? "教育背景与经历（点击文字可直接改）" : "EDUCATION & EXPERIENCE (CLICK TO EDIT)"}
              </div>
              <div className="af-exp-editor-card">
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>
                  🎓 {lang === "zh" ? "教育背景" : "Education"}
                </span>
                <p
                  className="af-editable"
                  style={{ margin: 0, fontSize: 13 }}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const val = e.currentTarget.textContent?.trim() ?? "";
                    setGenerated((prev) => ({
                      ...prev,
                      basics: { ...prev.basics, education: { ...prev.basics.education, [lang]: val } },
                    }));
                    setHasGenerated(true);
                  }}
                >
                  {localize(generated.basics.education, lang) || (lang === "zh" ? "点击填写院校、专业与 GPA" : "Click to add school, degree & GPA")}
                </p>
              </div>
              {generated.experiences.map((exp, eIdx) => (
                <div key={`${exp.period}-${eIdx}`} className="af-exp-editor-card">
                  <div className="af-card-head-actions" style={{ marginBottom: 2 }}>
                    <span
                      className="af-editable"
                      style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const val = e.currentTarget.textContent?.trim() ?? "";
                        setGenerated((prev) => ({
                          ...prev,
                          experiences: prev.experiences.map((it, i) => (i === eIdx ? { ...it, period: val } : it)),
                        }));
                        setHasGenerated(true);
                      }}
                    >
                      {exp.period}
                    </span>
                    <button
                      type="button"
                      className="af-item-delete-btn"
                      title={lang === "zh" ? "删除此段经历" : "Delete experience"}
                      aria-label={lang === "zh" ? "删除此段经历" : "Delete experience"}
                      onClick={() => {
                        setGenerated((prev) => ({
                          ...prev,
                          experiences: prev.experiences.filter((_, i) => i !== eIdx),
                        }));
                        setHasGenerated(true);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <strong
                    className="af-editable"
                    style={{ fontSize: 14 }}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() ?? "";
                      setGenerated((prev) => ({
                        ...prev,
                        experiences: prev.experiences.map((it, i) =>
                          i === eIdx ? { ...it, company: { ...it.company, [lang]: val } } : it,
                        ),
                      }));
                      setHasGenerated(true);
                    }}
                  >
                    {localize(exp.company, lang)}
                  </strong>
                  <span
                    className="af-editable"
                    style={{ fontSize: 12.5, color: "var(--muted)" }}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() ?? "";
                      setGenerated((prev) => ({
                        ...prev,
                        experiences: prev.experiences.map((it, i) =>
                          i === eIdx ? { ...it, role: { ...it.role, [lang]: val } } : it,
                        ),
                      }));
                      setHasGenerated(true);
                    }}
                  >
                    {localize(exp.role, lang)}
                  </span>
                  <p
                    className="af-editable"
                    style={{ margin: "4px 0 0", fontSize: 13 }}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() ?? "";
                      setGenerated((prev) => ({
                        ...prev,
                        experiences: prev.experiences.map((it, i) =>
                          i === eIdx ? { ...it, summary: { ...it.summary, [lang]: val } } : it,
                        ),
                      }));
                      setHasGenerated(true);
                    }}
                  >
                    {localize(exp.summary, lang)}
                  </p>
                </div>
              ))}
              <button
                type="button"
                className="af-add-item-btn"
                onClick={() => {
                  setGenerated((prev) => ({
                    ...prev,
                    experiences: [
                      ...prev.experiences,
                      {
                        period: "2025 - Present",
                        company: { en: "Company / Organization", zh: "公司 / 组织名称" },
                        role: { en: "Role Title", zh: "担任职位" },
                        summary: { en: "Click to describe key responsibilities and achievements.", zh: "点击此处编辑职责与核心成果。" },
                      },
                    ],
                  }));
                  setHasGenerated(true);
                }}
              >
                <Plus size={14} />
                <span>{lang === "zh" ? "添加一段经历" : "Add an experience"}</span>
              </button>
            </div>
          </div>
          </>
          )}
          </>
          )}
        </section>
      </div>

      <footer className="af-shell af-footer"><SiteLinks lang={lang} /></footer>

      <PricingModal
        open={pricingOpen}
        onClose={() => {
          setPricingOpen(false);
          setCheckoutBusyTier(null);
          setPricingError(null);
        }}
        lang={lang}
        currentPlan={currentPlan}
        isTrial={Boolean(user?.isTrial)}
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
                    ✓ {lang === "zh" ? `每月 ${PLAN_CREDITS[redeemSuccess.plan]} 基础点` : `${PLAN_CREDITS[redeemSuccess.plan]} base credits per month`}
                  </span>
                  <span>
                    ✓ {lang === "zh" ? `AI 多轮精修每次 ${CREDIT_COST.edit} 点` : `AI Live Refine costs ${CREDIT_COST.edit} credits per turn`}
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
                    ? "输入内测或活动兑换码，立即解锁高级模型、AI 多轮实时精修与每月创作点数。"
                    : "Enter your invite code to unlock premium models, AI Live Refine, and monthly creation credits."}
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

      {authModalOpen && <StudioLoginDialog lang={lang} referralCode={pendingRefCode} intent={authIntent}
        onClose={closeAuth} onVerified={authenticated} />}
    </main>
  );
}
