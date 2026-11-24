"use client";

import {
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCopy,
  Command,
  FileSearch,
  Mail,
  MessageSquare,
  Palette,
  Quote,
  RotateCcw,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSiteUrl, profile as defaultProfile } from "../lib/profile";
import { parseCitations } from "../lib/citations";
import {
  isValidTheme,
  localize,
  THEMES,
  type Lang,
  type PortfolioProfile,
  type ThemeId,
} from "../lib/schema";

export type VisitorPersona = "default" | "hr" | "cto" | "founder";

export interface ExecutedTool {
  name: string;
  args: Record<string, string>;
}

interface TraceMeta {
  model: string;
  requestedModel?: string;
  ttftMs: number;
  totalMs: number;
  edge: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  quote?: string;
  tools?: ExecutedTool[];
  trace?: TraceMeta;
}

interface PortfolioAIContextValue {
  activeProfile: PortfolioProfile;
  profileSlug?: string;
  modalProjectSlug: string | null;
  setModalProjectSlug: (slug: string | null) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  cmdOpen: boolean;
  setCmdOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  quote: string;
  setQuote: (q: string) => void;
  persona: VisitorPersona;
  setPersona: (p: VisitorPersona) => void;
  prefillPrompt: string | null;
  clearPrefillPrompt: () => void;
  pendingJd: string | null;
  clearPendingJd: () => void;
  executeTool: (tool: ExecutedTool) => void;
  showToast: (text: string) => void;
}

const PortfolioAIContext = createContext<PortfolioAIContextValue | null>(null);

export function usePortfolioAI() {
  const ctx = useContext(PortfolioAIContext);
  if (!ctx) throw new Error("usePortfolioAI must be used within PortfolioAIProvider");
  return ctx;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function buildMailtoHref(email: string, subject: string, body: string): string {
  const parts: string[] = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  return parts.length ? `mailto:${email}?${parts.join("&")}` : `mailto:${email}`;
}

export function PortfolioAIProvider({
  activeProfile = defaultProfile,
  profileSlug,
  lang,
  setLang,
  theme,
  setTheme,
  children,
}: {
  activeProfile?: PortfolioProfile;
  profileSlug?: string;
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  children: React.ReactNode;
}) {
  const profile = activeProfile;
  const router = useRouter();
  const [modalProjectSlug, setModalProjectSlug] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [quote, setQuote] = useState("");
  const [persona, setPersona] = useState<VisitorPersona>("default");
  const [prefillPrompt, setPrefillPrompt] = useState<string | null>(null);
  const [pendingJd, setPendingJd] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const executeTool = useCallback(
    (tool: ExecutedTool) => {
      if (tool.name === "open_project" && tool.args.slug) {
        if (profileSlug) {
          setModalProjectSlug(tool.args.slug);
        } else {
          router.push(`/projects/${tool.args.slug}`);
        }
        showToast(lang === "zh" ? `已打开案例：${tool.args.slug}` : `Opened case: ${tool.args.slug}`);
      } else if (tool.name === "scroll_to_section" && tool.args.section) {
        const el = document.getElementById(tool.args.section);
        if (el) {
          el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        } else if (!profileSlug) {
          router.push(`/#${tool.args.section}`);
        }
        showToast(lang === "zh" ? `已定位到 #${tool.args.section}` : `Scrolled to #${tool.args.section}`);
      } else if (tool.name === "switch_language" && (tool.args.lang === "en" || tool.args.lang === "zh")) {
        setLang(tool.args.lang);
        showToast(tool.args.lang === "zh" ? "已切换为中文" : "Switched to English");
      } else if (tool.name === "switch_theme" && !profileSlug && isValidTheme(tool.args.theme)) {
        setTheme(tool.args.theme);
        showToast(lang === "zh" ? `已切换主题：${tool.args.theme}` : `Switched theme: ${tool.args.theme}`);
      } else if (tool.name === "copy_contact" && profile.basics.email) {
        void navigator.clipboard?.writeText(profile.basics.email);
        showToast(lang === "zh" ? `已复制邮箱：${profile.basics.email}` : `Copied ${profile.basics.email}`);
      } else if (tool.name === "draft_email" && profile.basics.email) {
        const subject = tool.args.subject || (lang === "zh" ? "面试邀约 / 合作交流" : "Interview Invite / Opportunity");
        const body =
          tool.args.body ||
          (lang === "zh"
            ? `你好 ${profile.basics.name.zh}，看了你的作品集，想约个时间交流。`
            : `Hi ${profile.basics.name.en}, I enjoyed your portfolio and would love to connect.`);
        window.location.href = buildMailtoHref(profile.basics.email, subject, body);
        showToast(lang === "zh" ? "正在拉起邮件客户端…" : "Opening your mail client…");
      }
    },
    [lang, profile.basics.email, profile.basics.name.en, profile.basics.name.zh, profileSlug, router, setLang, setTheme, showToast],
  );

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Deep links: ?ask= / ?jd= / ?theme=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ask = params.get("ask")?.trim();
    const jd = params.get("jd")?.trim();
    const themeParam = params.get("theme")?.trim();
    if (!ask && !jd && !themeParam) return;

    const raf = window.requestAnimationFrame(() => {
      if (themeParam && isValidTheme(themeParam)) {
        setTheme(themeParam);
      }
      if (jd) {
        setPendingJd(jd.slice(0, 4000));
        setChatOpen(true);
      } else if (ask) {
        setPrefillPrompt(ask.slice(0, 300));
        setChatOpen(true);
      }
      if (ask || jd) {
        params.delete("ask");
        params.delete("jd");
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
        window.history.replaceState(null, "", nextUrl);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [setTheme]);

  // DevTools console easter egg + window.hire()
  useEffect(() => {
    const key = "talkcv-console-hello";
    if (!window.sessionStorage.getItem(key)) {
      window.sessionStorage.setItem(key, "1");
      console.log(
        `%c[${profile.basics.initials}] ${profile.basics.name.en} — TalkCV`,
        "color:#0d7a5f;font-weight:700;font-size:13px;",
      );
      console.log(
        lang === "zh"
          ? "在看源码？我们该聊聊。输入 hire() 一键起草邮件。"
          : "Reading the source? We should talk. Type hire() to draft an email.",
      );
      console.log("Agents & crawlers: /llms.txt · /resume.json");
    }

    window.hire = () => {
      executeTool({
        name: "draft_email",
        args: {
          subject: lang === "zh" ? "来自控制台的面试邀约" : "Interview invite (via DevTools)",
          body:
            lang === "zh"
              ? `你好 ${profile.basics.name.zh}，我在浏览器控制台输入了 hire()，想约个时间聊聊合作机会。`
              : `Hi ${profile.basics.name.en}, I found hire() in DevTools and would love to chat about a role.`,
        },
      });
      return "✉️ Opening your mail client…";
    };

    return () => {
      delete window.hire;
    };
  }, [executeTool, lang, profile.basics.initials, profile.basics.name.en, profile.basics.name.zh]);

  const value = useMemo<PortfolioAIContextValue>(
    () => ({
      activeProfile: profile,
      profileSlug,
      modalProjectSlug,
      setModalProjectSlug,
      chatOpen,
      setChatOpen,
      cmdOpen,
      setCmdOpen,
      quote,
      setQuote,
      persona,
      setPersona,
      prefillPrompt,
      clearPrefillPrompt: () => setPrefillPrompt(null),
      pendingJd,
      clearPendingJd: () => setPendingJd(null),
      executeTool,
      showToast,
    }),
    [profile, profileSlug, modalProjectSlug, chatOpen, cmdOpen, quote, persona, prefillPrompt, pendingJd, executeTool, showToast],
  );

  return (
    <PortfolioAIContext.Provider value={value}>
      {children}
      {toast && (
        <div className="af-toast" role="status" aria-live="polite" data-theme={theme}>
          <CheckCircle2 size={15} />
          <span>{toast}</span>
        </div>
      )}
    </PortfolioAIContext.Provider>
  );
}

/* ---------------- Selection Ask Popover ---------------- */
export function SelectionAskPopover({ lang }: { lang: Lang }) {
  const { activeProfile: profile, setQuote, setChatOpen } = usePortfolioAI();
  const [popover, setPopover] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!profile.ai.enabled) return;
    const onMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text.length < 10 || text.length > 360 || !sel || sel.rangeCount === 0) {
        setPopover(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setPopover(null);
        return;
      }
      setPopover({
        text,
        x: Math.min(window.innerWidth - 150, Math.max(16, rect.left + rect.width / 2 - 64)),
        y: Math.max(76, rect.top - 42),
      });
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [profile.ai.enabled]);

  if (!popover) return null;

  return (
    <button
      type="button"
      className="af-selection-btn"
      style={{ left: popover.x, top: popover.y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setQuote(popover.text);
        setChatOpen(true);
        setPopover(null);
        window.getSelection()?.removeAllRanges();
      }}
    >
      <Sparkles size={13} />
      <span>{lang === "zh" ? "问 AI 这段" : "Ask AI"}</span>
    </button>
  );
}

/* ---------------- Command Palette (⌘K) ---------------- */
export function CommandPalette({
  lang,
  setLang,
  theme,
  setTheme,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}) {
  const {
    activeProfile: profile,
    profileSlug,
    setModalProjectSlug,
    cmdOpen,
    setCmdOpen,
    setChatOpen,
    showToast,
  } = usePortfolioAI();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cmdOpen) {
      const raf = window.requestAnimationFrame(() => {
        setActiveIdx(0);
        inputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [cmdOpen]);

  if (!cmdOpen) return null;

  const isPersonalHosted = Boolean(profileSlug);
  const actions = [
    ...(!isPersonalHosted
      ? [
          {
            id: "create-own",
            label: lang === "zh" ? "免费生成我的个人站 (/create)" : "Build your own TalkCV free (/create)",
            run: () => router.push("/create"),
          },
          ...THEMES.map((t) => ({
            id: `theme-${t.id}`,
            label:
              lang === "zh"
                ? `切换主题：${t.label.zh}${theme === t.id ? "（当前）" : ""}`
                : `Switch theme: ${t.label.en}${theme === t.id ? " (active)" : ""}`,
            run: () => {
              setTheme(t.id);
              showToast(lang === "zh" ? `已切换为 ${t.label.zh}` : `Switched to ${t.label.en}`);
            },
          })),
        ]
      : []),
    ...profile.projects.map((p) => ({
      id: `proj-${p.slug}`,
      label: `${lang === "zh" ? "打开案例" : "Open case"}: ${localize(p.title, lang)}`,
      run: () => {
        if (isPersonalHosted) setModalProjectSlug(p.slug);
        else router.push(`/projects/${p.slug}`);
      },
    })),
    {
      id: "copy-jd-link",
      label: lang === "zh" ? "复制 JD 匹配分享链接 (?jd=)" : "Copy JD-match share link (?jd=)",
      run: () => {
        const base =
          isPersonalHosted && profileSlug !== "__draft__"
            ? `${window.location.origin}/u/${profileSlug}`
            : window.location.origin || getSiteUrl();
        void navigator.clipboard?.writeText(`${base}?jd=`);
        showToast(lang === "zh" ? "已复制，把 JD 拼在链接后即可" : "Copied! Append any JD text after ?jd=");
      },
    },
    {
      id: "toggle-lang",
      label: lang === "zh" ? "Switch to English" : "切换为中文",
      run: () => setLang(lang === "zh" ? "en" : "zh"),
    },
    ...(profile.ai.enabled
      ? [
          {
            id: "open-ai",
            label: lang === "zh" ? "打开 AI 助手" : "Open AI Assistant",
            run: () => setChatOpen(true),
          },
        ]
      : []),
  ];

  const q = query.trim().toLowerCase();
  const filtered = q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;
  const clampedIdx = filtered.length > 0 ? Math.min(activeIdx, filtered.length - 1) : 0;

  return (
    <div
      className="af-cmd-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setCmdOpen(false)}
    >
      <div className="af-cmd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="af-cmd-head">
          <Command size={15} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setCmdOpen(false);
              } else if (e.key === "ArrowDown" && filtered.length > 0) {
                e.preventDefault();
                setActiveIdx((prev) => (prev + 1) % filtered.length);
              } else if (e.key === "ArrowUp" && filtered.length > 0) {
                e.preventDefault();
                setActiveIdx((prev) => (prev - 1 + filtered.length) % filtered.length);
              } else if (e.key === "Enter" && filtered[clampedIdx]) {
                e.preventDefault();
                filtered[clampedIdx].run();
                setCmdOpen(false);
                setQuery("");
              }
            }}
            placeholder={
              isPersonalHosted
                ? lang === "zh"
                  ? "搜索项目、复制 JD 链接或打开 AI 助手…"
                  : "Search cases, copy JD link, or open AI…"
                : lang === "zh"
                  ? "搜索项目、切换主题或执行命令…"
                  : "Search cases, switch themes, or run commands…"
            }
          />
          <button type="button" onClick={() => setCmdOpen(false)} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="af-cmd-list">
          {filtered.length === 0 ? (
            <div className="af-cmd-empty">
              {lang === "zh" ? "未找到匹配的命令" : "No matching commands"}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`af-cmd-item${idx === clampedIdx ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => {
                  item.run();
                  setCmdOpen(false);
                  setQuery("");
                }}
              >
                {item.id.startsWith("theme-") ? <Palette size={14} /> : <Sparkles size={14} />}
                <span>{item.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Lightweight Markdown Renderer ---------------- */
function renderInline(text: string, evidence: (part: string) => React.ReactNode): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) nodes.push(evidence(text.slice(last, match.index)));
    const tok = match[0];
    if (tok.startsWith("**")) nodes.push(<strong key={k++}>{evidence(tok.slice(2, -2))}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={k++} className="af-inline-code">{evidence(tok.slice(1, -1))}</code>);
    last = match.index + tok.length;
  }
  if (last < text.length) nodes.push(evidence(text.slice(last)));
  return nodes;
}

function SimpleMarkdown({ text, lang }: { text: string; lang: Lang }) {
  const { activeProfile, profileSlug, executeTool, setChatOpen } = usePortfolioAI();
  const evidence = (part: string) => parseCitations(part, activeProfile).map((item, index) => {
    if (typeof item === "string") return item;
    const project = item.kind === "project";
    const id = `${project ? "project" : "experience"}-${item.id}`;
    const label = project ? (lang === "zh" ? "项目" : "Project") : (lang === "zh" ? "经历" : "Experience");
    return <a className="af-citation" key={index} href={`${profileSlug ? "" : "/"}#${id}`} onClick={(event) => {
      const target = document.getElementById(id);
      setChatOpen(false);
      if (target) {
        event.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      } else if (project) {
        event.preventDefault();
        executeTool({ name: "open_project", args: { slug: item.id } });
      }
    }}>{label} · {localize(item.title, lang)}</a>;
  });
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  return (
    <div className="af-md">
      {lines.map((line, idx) => {
        const headingMatch = line.match(/^\s*(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const content = renderInline(headingMatch[2], evidence);
          if (level <= 2) return <h3 key={idx} className="af-md-h">{content}</h3>;
          return <h4 key={idx} className="af-md-h af-md-h-sub">{content}</h4>;
        }
        if (/^\s*[-*•]\s+/.test(line)) {
          return (
            <p key={idx} className="af-md-bullet">
              • {renderInline(line.replace(/^\s*[-*•]\s+/, ""), evidence)}
            </p>
          );
        }
        return <p key={idx}>{renderInline(line, evidence)}</p>;
      })}
    </div>
  );
}

function EditableEmailCard({
  email,
  initialSubject,
  initialBody,
  lang,
}: {
  email: string;
  initialSubject: string;
  initialBody: string;
  lang: Lang;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [copied, setCopied] = useState(false);

  return (
    <div className="af-email-card">
      <input
        type="text"
        className="af-email-subject-input"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        aria-label={lang === "zh" ? "邮件主题" : "Email subject"}
      />
      <textarea
        className="af-email-body-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        aria-label={lang === "zh" ? "邮件正文" : "Email body"}
      />
      <div className="af-email-actions">
        <a href={buildMailtoHref(email, subject, body)}>
          <Mail size={13} />
          <span>{lang === "zh" ? "打开邮件客户端" : "Open Mail App"}</span>
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(`To: ${email}\nSubject: ${subject}\n\n${body}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          <ClipboardCopy size={13} />
          <span>{copied ? (lang === "zh" ? "已复制" : "Copied") : lang === "zh" ? "复制" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------- AI Chat Drawer ---------------- */
function RecruiterLeadForm({ slug, lang }: { slug: string; lang: Lang }) {
  const zh = lang === "zh";
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(0);
  const failures: Record<number, string> = {
    400: zh ? "请检查微信号或邮箱及字段长度。" : "Check the WeChat ID or email and the field lengths.",
    401: zh ? "请刷新并重新解锁此站点。" : "Refresh and unlock this site first.",
    404: zh ? "此站点已下线。" : "This site is no longer available.",
    410: zh ? "此站点已到期。" : "This site has expired.",
    429: zh ? "提交过于频繁，请在 10 分钟后重试。" : "Too many submissions. Try again in 10 minutes.",
  };
  if (status === 201) return <p className="af-lead-form" role="status">{zh ? "已送达，感谢你留下联系方式。" : "Delivered. Thank you for leaving your contact details."}</p>;
  return <form className="af-lead-form" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setStatus(0);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(slug)}/leads`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fields),
      });
      setStatus(res.status);
    } catch { setStatus(503); }
    finally { setBusy(false); }
  }}>
    <label>{zh ? "称呼" : "Your name"}<input name="name" autoComplete="name" maxLength={80} /></label>
    <label>{zh ? "公司" : "Company"}<input name="company" autoComplete="organization" maxLength={120} /></label>
    <label>{zh ? "微信或邮箱（必填）" : "WeChat ID or email (required)"}<input name="contact" required maxLength={160} /></label>
    <label>{zh ? "岗位或留言（选填）" : "Role or message (optional)"}<textarea name="note" rows={2} maxLength={1000} /></label>
    {status !== 0 && <p role="alert">{failures[status] ?? (zh ? "提交失败，请重试。" : "Could not send. Please try again.")}</p>}
    <button className="af-jd-submit" disabled={busy}>{busy ? (zh ? "正在提交…" : "Sending…") : (zh ? "发送给候选人" : "Send to candidate")}</button>
  </form>;
}

export function PortfolioChatWidget({ lang }: { lang: Lang }) {
  const {
    activeProfile: profile,
    profileSlug,
    chatOpen,
    setChatOpen,
    quote,
    setQuote,
    persona,
    setPersona,
    prefillPrompt,
    clearPrefillPrompt,
    pendingJd,
    clearPendingJd,
    executeTool,
  } = usePortfolioAI();

  const storageKey = `talkcv-chat:${profileSlug || "demo"}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydratedChat, setHydratedChat] = useState(false);
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState<"chat" | "jd" | "leads">("chat");
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setMessages(parsed as ChatMessage[]);
        }
      } catch {
        // ignore storage errors
      } finally {
        setHydratedChat(true);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedChat) return;
    try {
      if (messages.length === 0) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-24)));
    } catch {
      // ignore storage quota errors
    }
  }, [hydratedChat, messages, storageKey]);

  useEffect(() => {
    if (!prefillPrompt) return;
    const raf = window.requestAnimationFrame(() => {
      setPanel("chat");
      setInput(prefillPrompt);
      clearPrefillPrompt();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [prefillPrompt, clearPrefillPrompt]);

  useEffect(() => {
    if (!pendingJd) return;
    const raf = window.requestAnimationFrame(() => {
      setPanel("jd");
      setJdText(pendingJd);
      clearPendingJd();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pendingJd, clearPendingJd]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, error, loading]);

  if (!profile.ai.enabled) return null;

  const sendMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || loading) return;

    const currentQuote = quote;
    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed, quote: currentQuote || undefined },
      { role: "assistant", content: "" },
    ];
    setMessages(nextHistory);
    setInput("");
    setQuote("");
    setPanel("chat");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory
            .filter((m) => m.content)
            .map((m) => ({ role: m.role, content: m.content })),
          lang,
          persona,
          quote: currentQuote,
          ...(profileSlug ? { profileSlug } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "AI service unavailable.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as {
              delta?: string;
              tool?: ExecutedTool;
              meta?: TraceMeta;
              error?: string;
            };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.tool) {
              executeTool(parsed.tool);
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = {
                    ...last,
                    tools: [...(last.tools ?? []), parsed.tool!],
                  };
                }
                return copy;
              });
            }
            if (parsed.delta) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: last.content + parsed.delta };
                }
                return copy;
              });
            }
            if (parsed.meta) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, trace: parsed.meta };
                }
                return copy;
              });
            }
          } catch (innerErr) {
            if (innerErr instanceof Error && innerErr.message === "Stream interrupted.") {
              throw innerErr;
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setMessages((prev) => prev.filter((m, idx) => !(idx === prev.length - 1 && m.role === "assistant" && !m.content)));
    } finally {
      setLoading(false);
    }
  };

  const prompts = (profile.ai.suggestedPrompts[lang] ?? profile.ai.suggestedPrompts.en).filter(
    (p) => !profileSlug || !/theme|主题/i.test(p),
  );

  return (
    <div className="af-ai-widget">
      {chatOpen && (
        <section className="af-ai-drawer" aria-label={localize(profile.ai.assistantName, lang)}>
          <header className="af-ai-head">
            <div className="af-ai-title">
              <Sparkles size={16} />
              <div>
                <strong>{localize(profile.ai.assistantName, lang)}</strong>
                <span>Tool Calling · JD Match · Live Trace</span>
              </div>
            </div>
            <div className="af-ai-head-actions">
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                  try {
                    window.sessionStorage.removeItem(storageKey);
                  } catch {
                    // ignore
                  }
                }}
                aria-label="Reset conversation"
                title={lang === "zh" ? "重置对话" : "Reset"}
              >
                <RotateCcw size={14} />
              </button>
              <button type="button" onClick={() => setChatOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
          </header>

          <div className="af-ai-toolbar">
            <div className="af-persona-group">
              {(["default", "hr", "cto", "founder"] as VisitorPersona[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={persona === p ? "active" : ""}
                  onClick={() => setPersona(p)}
                >
                  {p === "default"
                    ? lang === "zh"
                      ? "综合"
                      : "All"
                    : p === "hr"
                      ? "HR"
                      : p === "cto"
                        ? "CTO"
                        : lang === "zh"
                          ? "创始人"
                          : "Founder"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`af-jd-btn ${panel === "jd" ? "active" : ""}`}
              onClick={() => setPanel(panel === "jd" ? "chat" : "jd")}
            >
              <BriefcaseBusiness size={12} />
              <span>{lang === "zh" ? "贴 JD 测匹配" : "Match JD"}</span>
            </button>
            {profileSlug && profileSlug !== "__draft__" && <button type="button" className={`af-jd-btn ${panel === "leads" ? "active" : ""}`}
              aria-expanded={panel === "leads"} onClick={() => setPanel(panel === "leads" ? "chat" : "leads")}>
              <Mail size={12} />{lang === "zh" ? "约面 / 留联系方式" : "Invite / leave contact"}
            </button>}
          </div>

          {panel === "leads" && profileSlug ? <RecruiterLeadForm key={profileSlug} slug={profileSlug} lang={lang} /> : panel === "jd" ? (
            <div className="af-jd-panel">
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder={
                  lang === "zh"
                    ? "粘贴目标岗位 JD，AI 会生成客观的匹配点、差距与建议面试问题…"
                    : "Paste a Job Description for an honest match report…"
                }
                maxLength={2200}
              />
              <button
                type="button"
                className="af-jd-submit"
                disabled={!jdText.trim() || loading}
                onClick={() => {
                  const text = jdText.trim();
                  setJdText("");
                  void sendMessage(
                    lang === "zh"
                      ? `请对照以下岗位 JD 生成一份客观匹配报告（核心命中点 + 诚实差距 + 建议面试探讨点）：\n\n${text}`
                      : `Evaluate fit against this Job Description (strong matches, honest gaps, suggested interview topics):\n\n${text}`,
                  );
                }}
              >
                <FileSearch size={15} />
                <span>{lang === "zh" ? "生成匹配报告" : "Analyze Fit"}</span>
              </button>
            </div>
          ) : (
            <div className="af-ai-messages" ref={listRef}>
              <div className="af-bubble af-bubble-bot">{localize(profile.ai.welcome, lang)}</div>
              {messages.length === 0 && (
                <div className="af-prompts">
                  {prompts.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((msg, idx) => (
                <div key={idx} className={`af-turn ${msg.role === "user" ? "af-turn-user" : "af-turn-bot"}`}>
                  {msg.quote && (
                    <div className="af-msg-quote">
                      <Quote size={11} />
                      <span>{msg.quote}</span>
                    </div>
                  )}
                  {msg.tools && msg.tools.length > 0 && (
                    <div className="af-tool-pills">
                      {msg.tools.map((tc, tIdx) => (
                        <span key={tIdx} className="af-tool-pill">
                          <Zap size={11} />
                          <code>{tc.name}</code>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={`af-bubble ${msg.role === "user" ? "af-bubble-user" : "af-bubble-bot"}`}>
                    {msg.role === "assistant" ? (
                      msg.content ? <SimpleMarkdown text={msg.content} lang={lang} /> : "…"
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.tools
                    ?.filter((tc) => tc.name === "draft_email" && profile.basics.email)
                    .map((tc, eIdx) => (
                      <EditableEmailCard
                        key={eIdx}
                        email={profile.basics.email}
                        initialSubject={tc.args.subject ?? ""}
                        initialBody={tc.args.body ?? ""}
                        lang={lang}
                      />
                    ))}
                  {msg.trace && (
                    <div className="af-trace-bar">
                      <span>
                        {msg.trace.requestedModel && msg.trace.requestedModel !== msg.trace.model
                          ? `${msg.trace.model} (fallback from ${msg.trace.requestedModel})`
                          : msg.trace.model}
                      </span>
                      <span>TTFT {(msg.trace.ttftMs / 1000).toFixed(2)}s</span>
                      <span>CF:{msg.trace.edge}</span>
                    </div>
                  )}
                </div>
              ))}
              {error && <div className="af-ai-error">{error}</div>}
            </div>
          )}

          {quote && panel === "chat" && (
            <div className="af-quote-banner">
              <Quote size={12} />
              <span>{quote}</span>
              <button type="button" onClick={() => setQuote("")} aria-label="Clear quote">
                <X size={12} />
              </button>
            </div>
          )}

          {panel !== "leads" && <form
            className="af-ai-form"
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input || (quote ? (lang === "zh" ? "请解释这段内容" : "Explain this excerpt") : ""));
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                profileSlug
                  ? lang === "zh"
                    ? "问项目架构、贴 JD 或起草约面邮件…"
                    : "Ask about projects, match a JD, or draft an invite…"
                  : lang === "zh"
                    ? "问项目架构、切换主题或约面…"
                    : "Ask about projects, themes, or contact…"
              }
              maxLength={2200}
            />
            <button type="submit" disabled={loading || (!input.trim() && !quote)} aria-label="Send">
              <Send size={15} />
            </button>
          </form>}
        </section>
      )}

      <button
        type="button"
        className="af-ai-fab"
        onClick={() => setChatOpen((prev) => !prev)}
        aria-expanded={chatOpen}
      >
        <MessageSquare size={16} />
        <span>{lang === "zh" ? "问 AI 助手" : "Ask AI"}</span>
      </button>
    </div>
  );
}
