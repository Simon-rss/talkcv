"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  Command,
  FileText,
  Home,
  Palette,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { SharePoster } from "./share-poster";
import { ResumeExport } from "./resume-export";
import { ContactLinks } from "./contact-links";
import { SiteLinks } from "./public-navigation";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSiteUrl, profile as defaultProfile } from "../lib/profile";
import {
  isValidTheme,
  localize,
  THEMES,
  type Lang,
  type PortfolioProfile,
  type ProjectItem,
  type ThemeId,
} from "../lib/schema";
import { creationPricing, PLAN_CREDITS } from "../lib/credits";
import { AccountMenu } from "./account-menu";
import {
  CommandPalette,
  PortfolioAIProvider,
  PortfolioChatWidget,
  prefersReducedMotion,
  SelectionAskPopover,
  usePortfolioAI,
} from "./ai-experience";

interface AppContextValue {
  profile: PortfolioProfile;
  profileSlug?: string;
  ownerRefCode?: string;
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

function AppProvider({
  initialProfile = defaultProfile,
  initialLang,
  profileSlug,
  ownerRefCode,
  children,
}: {
  initialProfile?: PortfolioProfile;
  initialLang?: Lang;
  profileSlug?: string;
  ownerRefCode?: string;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang ?? "en");
  const [theme, setThemeState] = useState<ThemeId>(initialProfile.theme || "editorial");

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const savedLang = window.localStorage.getItem("talkcv-lang");
      if (!initialLang && (savedLang === "en" || savedLang === "zh")) setLangState(savedLang);
      if (!profileSlug) {
        const savedTheme = window.localStorage.getItem("talkcv-theme");
        if (isValidTheme(savedTheme)) setThemeState(savedTheme);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [profileSlug, initialLang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
    const tokens = initialProfile.designTokens;
    const root = document.documentElement.style;
    const keys = ["--accent", "--bg", "--surface", "--radius"] as const;
    for (const k of keys) root.removeProperty(k);
    if (tokens?.accent) root.setProperty("--accent", tokens.accent);
    if (tokens?.bg) root.setProperty("--bg", tokens.bg);
    if (tokens?.surface) root.setProperty("--surface", tokens.surface);
    if (tokens?.radius) root.setProperty("--radius", tokens.radius);

    // Dynamic tab title & favicon for personal sites / preview
    if (profileSlug) {
      const displayName = localize(initialProfile.basics.name, lang);
      document.title =
        lang === "zh" ? `${displayName} · 个人交互简历` : `${displayName} · Interactive CV`;

      let faviconHref = initialProfile.basics.avatar || "";
      if (!faviconHref) {
        const bg = tokens?.accent || (theme === "terminal" ? "#10b981" : theme === "bento" ? "#4f46e5" : "#0d7a5f");
        const initials = (initialProfile.basics.initials || "TC").slice(0, 2).replace(/[<>&"']/g, "");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${bg}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-weight="700" font-size="26">${initials}</text></svg>`;
        faviconHref = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      }
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = faviconHref;
    }

    return () => {
      for (const k of keys) root.removeProperty(k);
    };
  }, [initialProfile.basics.avatar, initialProfile.basics.initials, initialProfile.basics.name, initialProfile.designTokens, lang, profileSlug, theme]);

  const setLang = (next: Lang) => {
    setLangState(next);
    window.localStorage.setItem("talkcv-lang", next);
  };

  const setTheme = (next: ThemeId) => {
    setThemeState(next);
    window.localStorage.setItem("talkcv-theme", next);
  };

  const value = useMemo(
    () => ({ profile: initialProfile, profileSlug, ownerRefCode, lang, setLang, theme, setTheme }),
    [initialProfile, profileSlug, ownerRefCode, lang, theme],
  );

  return (
    <AppContext.Provider value={value}>
      <PortfolioAIProvider
        activeProfile={initialProfile}
        profileSlug={profileSlug}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
      >
        {children}
        <SelectionAskPopover lang={lang} />
        <CommandPalette lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} />
        <PortfolioChatWidget lang={lang} />
      </PortfolioAIProvider>
    </AppContext.Provider>
  );
}

function CountUpValue({ value }: { value: string }) {
  const match = useMemo(() => /^([+-]?)(\d+)(.*)$/.exec(value.trim()), [value]);
  const [display, setDisplay] = useState(value);
  const elRef = useRef<HTMLElement>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!match || !el || animatedRef.current || prefersReducedMotion()) return;
    const prefix = match[1];
    const target = Number(match[2]);
    const suffix = match[3];
    if (!Number.isFinite(target) || target <= 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || animatedRef.current) return;
        animatedRef.current = true;
        observer.disconnect();
        const start = performance.now();
        const duration = 800;
        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplay(`${prefix}${Math.round(target * eased)}${suffix}`);
          if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [match]);

  return (
    <strong ref={elRef} className="tabular-num">
      {display}
    </strong>
  );
}

function SiteHeader({ casePage = false }: { casePage?: boolean }) {
  const { profile, profileSlug, lang, setLang, theme, setTheme } = useApp();
  const { setCmdOpen } = usePortfolioAI();
  const isPersonalHosted = Boolean(profileSlug);
  const homeHref = profileSlug === "__draft__" ? "/preview" : isPersonalHosted ? `/u/${profileSlug}` : "/";

  return (
    <header className="af-header">
      <Link className="af-brand" href={homeHref}>
        {profile.basics.avatar ? (
          <img className="af-brand-avatar" src={profile.basics.avatar} alt={localize(profile.basics.name, lang)} />
        ) : (
          <span className="af-brand-mark">{profile.basics.initials}</span>
        )}
        <strong>{localize(profile.basics.name, lang)}</strong>
        {isPersonalHosted && (
          <span className="af-brand-sub">{lang === "zh" ? "个人简历" : "Interactive CV"}</span>
        )}
      </Link>

      <nav className="af-nav" aria-label="Primary">
        <Link href={casePage ? "/#work" : "#work"}>{lang === "en" ? "Work" : "项目"}</Link>
        <Link href={casePage ? "/#capabilities" : "#capabilities"}>{lang === "en" ? "Capabilities" : "能力"}</Link>
        <Link href={casePage ? "/#experience" : "#experience"}>{lang === "en" ? "Experience" : "经历"}</Link>
        <Link href={casePage ? "/#contact" : "#contact"}>{lang === "en" ? "Contact" : "联系"}</Link>
        {!isPersonalHosted && (
          <Link className="af-nav-create" href="/create">
            {lang === "en" ? "Create Yours" : "免费生成"}
          </Link>
        )}
      </nav>

      <div className="af-header-controls">
        {!isPersonalHosted && (
          <Link className="af-nav-create af-mobile-create" href="/create">
            {lang === "en" ? "Create" : "免费生成"}
          </Link>
        )}
        {!isPersonalHosted && (
          <div className="af-theme-switcher" role="group" aria-label={lang === "en" ? "Theme" : "主题"}>
            <Palette size={13} aria-hidden="true" />
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={theme === item.id ? "active" : ""}
                onClick={() => setTheme(item.id)}
                title={localize(item.description, lang)}
              >
                {localize(item.label, lang)}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="af-icon-pill"
          onClick={() => setCmdOpen(true)}
          aria-label="Command palette"
          title="⌘K"
        >
          <Command size={13} />
          <span>K</span>
        </button>

        <button
          type="button"
          className="af-icon-pill"
          onClick={() => setLang(lang === "en" ? "zh" : "en")}
          aria-label="Toggle language"
        >
          {lang === "en" ? "中" : "EN"}
        </button>
        {!isPersonalHosted && <AccountMenu lang={lang} />}
      </div>
    </header>
  );
}

function LiveClock({ lang }: { lang: Lang }) {
  const { profile } = useApp();
  const [clock, setClock] = useState<{ time: string; awake: boolean } | null>(null);

  useEffect(() => {
    const compute = () => {
      try {
        const now = new Date();
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: profile.basics.timezone || "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(now);
        const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
        const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
        setClock({ time: `${String(hour).padStart(2, "0")}:${minute}`, awake: hour >= 8 && hour < 23 });
      } catch {
        setClock(null);
      }
    };
    const raf = window.requestAnimationFrame(compute);
    const timer = window.setInterval(compute, 30000);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [profile.basics.timezone]);

  return (
    <p className="af-clock" aria-live="polite">
      {clock ? (
        <>
          <span className={`af-clock-dot ${clock.awake ? "is-awake" : "is-asleep"}`} />
          <Clock size={13} />
          <span>
            {localize(profile.basics.location, lang)} · {clock.time} ·{" "}
            {clock.awake
              ? lang === "en"
                ? "Awake & replying"
                : "通常在线"
              : lang === "en"
                ? "Likely asleep"
                : "夜间休息"}
          </span>
        </>
      ) : (
        <span>&nbsp;</span>
      )}
    </p>
  );
}

function ContactBand() {
  const { profile, lang } = useApp();
  return (
    <section className="af-contact" id="contact">
      <div className="af-shell af-contact-grid">
        <div>
          <p className="af-eyebrow">{lang === "en" ? "CONTACT" : "联系交流"}</p>
          <h2>{lang === "en" ? "Let's build something that ships." : "聊聊合作或岗位机会。"}</h2>
        </div>
        <div className="af-contact-copy">
          <LiveClock lang={lang} />
          <ContactLinks basics={profile.basics} lang={lang} />
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const { profile, profileSlug, ownerRefCode, lang } = useApp();
  const buildSha = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";
  const isPersonalHosted = Boolean(profileSlug);
  const refHref = ownerRefCode ? `/create?ref=${encodeURIComponent(ownerRefCode)}` : "/create";

  return (
    <footer className="af-footer af-shell">
      <div className="af-footer-row">
        <span>
          © {new Date().getFullYear()} {localize(profile.basics.name, lang)}
        </span>
        {isPersonalHosted ? (
          !profile.hideBranding && (
            <Link href={refHref} className="af-powered-by">
              {lang === "en" ? "Hosted with TalkCV" : "由 TalkCV 托管"}
            </Link>
          )
        ) : (
          <span>{localize(profile.basics.footerNote, lang)}</span>
        )}
      </div>
      {!isPersonalHosted && (
        <div className="af-footer-meta">
          <SiteLinks lang={lang} />
          <a href="/llms.txt">
            {lang === "en" ? "Agents: read /llms.txt" : "给 AI 读的版本：/llms.txt"}
          </a>
          <span>
            {lang === "en" ? `Built from ${buildSha}` : `构建版本 ${buildSha}`} ·{" "}
            <a href="/resume.json">/resume.json</a>
          </span>
        </div>
      )}
    </footer>
  );
}

function HomeContent({ exportSlug }: { exportSlug?: string }) {
  const { profile, profileSlug, lang, theme } = useApp();
  const { setChatOpen, modalProjectSlug, setModalProjectSlug } = usePortfolioAI();
  const [filter, setFilter] = useState<"all" | "platform" | "enterprise" | "product">("all");
  const isPersonalHosted = Boolean(profileSlug);
  const modalProject = modalProjectSlug
    ? profile.projects.find((p) => p.slug === modalProjectSlug) ?? null
    : null;

  useEffect(() => {
    if (!modalProject) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModalProjectSlug(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalProject, setModalProjectSlug]);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("filter");
    if (param === "platform" || param === "enterprise" || param === "product") {
      const raf = window.requestAnimationFrame(() => setFilter(param));
      return () => window.cancelAnimationFrame(raf);
    }
  }, []);

  const updateFilter = (next: "all" | "platform" | "enterprise" | "product") => {
    setFilter(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "all") params.delete("filter");
    else params.set("filter", next);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  };

  const visibleProjects =
    filter === "all" ? profile.projects : profile.projects.filter((p) => p.group === filter);

  return (
    <main className={`af-page af-theme-${theme}`}>
      {profileSlug === "__draft__" && <div className="af-preview-strip">
        <span>{lang === "zh" ? "全屏草稿预览 · 二维码指向发布后的站点" : "Draft preview · The QR code links to the published site"}</span>
        <Link href={`/create?lang=${lang}`}>{lang === "zh" ? "返回工作台发布 →" : "Back to Studio to publish →"}</Link>
      </div>}
      <SiteHeader />

      {!isPersonalHosted && (
        <section className="af-storefront-band">
          <div className="af-shell af-storefront-card">
            <div className="af-storefront-top">
              <div>
                <p className="af-eyebrow">TALKCV · AI INTERACTIVE RÉSUMÉ BUILDER</p>
                <h2>
                  {lang === "zh"
                    ? "把你的 PDF / Word 简历变成自带 AI 助手的个人网站"
                    : "Turn your résumé into a hosted interactive portfolio with an AI assistant"}
                </h2>
                <p className="af-storefront-desc">
                  {lang === "zh"
                    ? `上传 PDF / Word 或粘贴简历，几秒生成专属 /u/你的名字 个人站，支持访客 AI 对话、JD 匹配、扫码 A4 PDF 导出、访客洞察和口令保护。Free 免费领取终身 ${PLAN_CREDITS.free} 点。Pro $20/月（$190/年），每月 ${PLAN_CREDITS.pro} 点。Max $49/月（$469/年），每月 ${PLAN_CREDITS.max.toLocaleString("en-US")} 点。`
                    : `Upload PDF/DOCX or paste your résumé to publish a personal /u/handle portfolio with visitor AI chat, JD matching, QR-enabled A4 PDF export, visitor insights and passcode privacy. Free includes ${PLAN_CREDITS.free} lifetime credits. Pro is $20/mo ($190/yr) with ${PLAN_CREDITS.pro} monthly credits. Max is $49/mo ($469/yr) with ${PLAN_CREDITS.max.toLocaleString("en-US")} monthly credits.`}
                  {" "}{creationPricing(lang)}
                </p>
              </div>
              <div className="af-storefront-actions">
                <Link className="af-btn af-btn-primary" href={`/create?lang=${lang}`}>
                  <Sparkles size={15} />
                  <span>{lang === "zh" ? "免费开始建站" : "Open TalkCV Studio"}</span>
                </Link>
                <Link className="af-btn af-btn-secondary" href={lang === "en" ? "/pricing?lang=en" : "/pricing"}>
                  <span>{lang === "zh" ? "查看会员价格 ($0 / $20 / $49)" : "View Pricing ($0 / $20 / $49)"}</span>
                </Link>
              </div>
            </div>
            {profile.basics.email === "alex.chen@example.dev" && (
              <div className="af-demo-notice" role="note">
                <strong>
                  {lang === "zh" ? "虚构示例演示（Alex Chen）" : "LIVE DEMO · FICTIONAL SAMPLE PROFILE (ALEX CHEN)"}
                </strong>
                <span>
                  {lang === "zh"
                    ? "下方展示的是用 TalkCV 生成的虚构人物示例站。所有经历、项目指标（如「12 个团队」「450+ 评测用例」）及示例邮箱 alex.chen@example.dev 均为演示占位数据，并非真实客户成绩。TalkCV 官方客服与条款见页面底部。"
                    : "The portfolio below is an interactive fictional demo of what TalkCV creates. All metrics (including '12 teams onboarded' and '450+ golden eval cases'), roles, and alex.chen@example.dev are illustrative sample placeholders, not verified customer results. Official TalkCV support & policies are linked in the footer."}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="af-hero">
        <div className="af-shell">
          <p className="af-role">{localize(profile.basics.role, lang)}</p>
          <h1>{localize(profile.basics.headline, lang)}</h1>
          <p className="af-intro">{localize(profile.basics.intro, lang)}</p>
          <p className="print-only">
            {profile.basics.email} ·{" "}
            {isPersonalHosted && profileSlug !== "__draft__"
              ? `https://talkcv.renss.top/u/${profileSlug}`
              : getSiteUrl()}
          </p>
          <div className="af-actions">
            <a className="af-btn af-btn-primary" href="#work">
              <span>{lang === "en" ? "Explore projects" : "查看代表项目"}</span>
              <ArrowUpRight size={16} />
            </a>
            {profile.ai.enabled && (
              <button type="button" className="af-btn af-btn-secondary" onClick={() => setChatOpen(true)}>
                <Sparkles size={16} />
                <span>{lang === "en" ? "Ask AI / Match JD" : "问 AI / 测 JD 匹配"}</span>
              </button>
            )}
            {profileSlug && profileSlug !== "__draft__" && <SharePoster profile={profile} slug={profileSlug} lang={lang} />}
          </div>
          <div className="af-skill-strip" aria-label="Skills">
            {profile.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        </div>
      </section>

      {isPersonalHosted && <ResumeExport profile={profile} slug={exportSlug} lang={lang} />}

      <section className="af-section af-shell" id="work">
        <div className="af-section-head">
          <div>
            <p className="af-eyebrow">{lang === "en" ? "SELECTED WORK" : "代表项目"}</p>
            <h2>{lang === "en" ? "Systems built for real constraints" : "面向真实约束的工程交付"}</h2>
          </div>
          <div className="af-filter-bar" role="tablist">
            {(
              [
                ["all", lang === "en" ? `All (${profile.projects.length})` : `全部 (${profile.projects.length})`],
                ["platform", lang === "en" ? "Platform" : "平台"],
                ["enterprise", lang === "en" ? "Enterprise" : "企业"],
                ["product", lang === "en" ? "Product" : "产品"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? "active" : ""}
                onClick={() => updateFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="af-projects-grid">
          {visibleProjects.map((project) => (
            <article key={project.slug} id={`project-${project.slug}`} tabIndex={-1} className={`af-card accent-${project.accent}`}>
              <div className="af-card-top">
                <span className="af-card-cat">{localize(project.category, lang)}</span>
                <div className="af-card-tags">
                  {project.tags.slice(0, 3).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <h3>
                {isPersonalHosted ? (
                  <button
                    type="button"
                    className="af-card-title-btn"
                    onClick={() => setModalProjectSlug(project.slug)}
                  >
                    {localize(project.title, lang)}
                  </button>
                ) : (
                  <Link href={`/projects/${project.slug}`}>{localize(project.title, lang)}</Link>
                )}
              </h3>
              <p className="af-card-role">
                <BriefcaseBusiness size={14} />
                <span>{localize(project.role, lang)}</span>
              </p>
              <p className="af-card-summary">{localize(project.summary, lang)}</p>
              <div className="af-facts">
                {project.facts.map((fact) => (
                  <div key={fact.value + fact.label.en}>
                    <CountUpValue value={fact.value} />
                    <span>{localize(fact.label, lang)}</span>
                  </div>
                ))}
              </div>
              {isPersonalHosted ? (
                <button
                  type="button"
                  className="af-card-cta af-card-cta-btn"
                  onClick={() => setModalProjectSlug(project.slug)}
                >
                  <span>{lang === "en" ? "View case details" : "查看案例详情"}</span>
                  <ArrowUpRight size={15} />
                </button>
              ) : (
                <Link className="af-card-cta" href={`/projects/${project.slug}`}>
                  <span>{lang === "en" ? "Read case study" : "查看案例详情"}</span>
                  <ArrowUpRight size={15} />
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="af-section af-band" id="capabilities">
        <div className="af-shell">
          <p className="af-eyebrow">{lang === "en" ? "CAPABILITIES" : "核心能力"}</p>
          <h2>{lang === "en" ? "Where engineering craft meets AI delivery" : "工程体系与 AI 落地的结合"}</h2>
          <div className="af-cap-grid">
            {profile.capabilities.map((cap) => (
              <article key={cap.title.en} className="af-cap-card">
                <h3>{localize(cap.title, lang)}</h3>
                <p>{localize(cap.summary, lang)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="af-section af-shell" id="experience">
        <div className="af-exp-layout">
          <div>
            <p className="af-eyebrow">{lang === "en" ? "EXPERIENCE" : "工作经历"}</p>
            <h2>{lang === "en" ? "Career timeline" : "职业履历"}</h2>
            <p className="af-edu">
              <FileText size={16} />
              <span>{localize(profile.basics.education, lang)}</span>
            </p>
          </div>
          <div className="af-timeline">
            {profile.experiences.map((exp, index) => (
              <article key={exp.period + exp.company.en} id={`experience-${index}`} tabIndex={-1} className="af-timeline-item">
                <time>{exp.period}</time>
                <div>
                  <h3>{localize(exp.company, lang)}</h3>
                  <p className="af-timeline-role">{localize(exp.role, lang)}</p>
                  <p>{localize(exp.summary, lang)}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ContactBand />
      <SiteFooter />

      {modalProject && (
        <div
          className="af-case-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={localize(modalProject.title, lang)}
          onClick={() => setModalProjectSlug(null)}
        >
          <div className="af-case-modal" onClick={(e) => e.stopPropagation()}>
            <div className="af-case-modal-head">
              <div>
                <p className="af-eyebrow">{localize(modalProject.category, lang)}</p>
                <h2>{localize(modalProject.title, lang)}</h2>
                <p className="af-card-role">
                  <BriefcaseBusiness size={14} />
                  <span>{localize(modalProject.role, lang)}</span>
                </p>
              </div>
              <button
                type="button"
                className="af-icon-pill"
                onClick={() => setModalProjectSlug(null)}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
            <div className="af-case-modal-body">
              <p className="af-intro">{localize(modalProject.summary, lang)}</p>
              {modalProject.facts.length > 0 && (
                <div className="af-facts af-case-facts">
                  {modalProject.facts.map((fact) => (
                    <div key={fact.value + fact.label.en}>
                      <strong>{fact.value}</strong>
                      <span>{localize(fact.label, lang)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="af-story-list">
                {modalProject.sections.map((section, idx) => (
                  <article key={section.title.en} className="af-story-card">
                    <span className="af-story-num">0{idx + 1}</span>
                    <div>
                      <p className="af-eyebrow">{localize(section.eyebrow, lang)}</p>
                      <h3>{localize(section.title, lang)}</h3>
                      <p>{localize(section.body, lang)}</p>
                      {section.items && (
                        <ul className="af-story-bullets">
                          {section.items.map((item) => (
                            <li key={item.en}>
                              <CheckCircle2 size={15} />
                              <span>{localize(item, lang)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {modalProject.workflow.length > 0 && (
                <div className="af-cap-grid" style={{ marginTop: 18 }}>
                  {modalProject.workflow.map((step) => (
                    <article key={step.number} className="af-cap-card">
                      <span className="af-story-num">{step.number}</span>
                      <h3>{localize(step.title, lang)}</h3>
                      <p>{localize(step.text, lang)}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function estimateReadingMinutes(project: ProjectItem, lang: Lang): number {
  const parts = [
    localize(project.summary, lang),
    ...project.sections.flatMap((s) => [
      localize(s.title, lang),
      localize(s.body, lang),
      ...(s.items ?? []).map((it) => localize(it, lang)),
    ]),
    ...project.workflow.flatMap((w) => [localize(w.title, lang), localize(w.text, lang)]),
  ];
  const text = parts.join(" ");
  if (lang === "zh") return Math.max(1, Math.ceil(text.replace(/\s+/g, "").length / 400));
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length / 220));
}

function CaseStudyContent({ project }: { project: ProjectItem }) {
  const { profile, lang, theme } = useApp();
  const router = useRouter();
  const { chatOpen, cmdOpen } = usePortfolioAI();
  const [progress, setProgress] = useState(0);

  const currentIndex = profile.projects.findIndex((p) => p.slug === project.slug);
  const currentTags = new Set(project.tags.map((t) => t.toLowerCase()));
  const related = profile.projects
    .map((candidate, idx) => ({
      candidate,
      overlap: candidate.tags.reduce((acc, t) => acc + (currentTags.has(t.toLowerCase()) ? 1 : 0), 0),
      cyclic: (idx - currentIndex + profile.projects.length) % profile.projects.length,
    }))
    .filter((entry) => entry.candidate.slug !== project.slug)
    .sort((a, b) => b.overlap - a.overlap || a.cyclic - b.cyclic)
    .slice(0, 2)
    .map((entry) => entry.candidate);

  const readingMinutes = estimateReadingMinutes(project, lang);

  useEffect(() => {
    let rafId = 0;
    const update = () => {
      rafId = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)));
    };
    const onScroll = () => {
      if (!rafId) rafId = window.requestAnimationFrame(update);
    };
    rafId = window.requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
    };
  }, [project.slug]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (chatOpen || cmdOpen || currentIndex < 0) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = profile.projects[(currentIndex + delta + profile.projects.length) % profile.projects.length];
      if (next) router.push(`/projects/${next.slug}`);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, cmdOpen, currentIndex, profile.projects, router]);

  return (
    <main className={`af-page af-theme-${theme}`}>
      <SiteHeader casePage />
      <div className={`af-reading-bar accent-${project.accent}`} aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <section className="af-case-hero">
        <div className="af-shell">
          <Link className="af-back-link" href="/#work">
            <ArrowLeft size={15} />
            <span>{lang === "en" ? "All projects" : "返回项目列表"}</span>
          </Link>
          <p className="af-eyebrow">{localize(project.category, lang)}</p>
          <h1>{localize(project.title, lang)}</h1>
          <p className="af-intro">{localize(project.summary, lang)}</p>
          <div className="af-case-meta">
            <span>
              <BriefcaseBusiness size={15} /> {localize(project.role, lang)}
            </span>
            <span>
              <Clock size={14} /> {lang === "en" ? `~${readingMinutes} min read` : `约 ${readingMinutes} 分钟阅读`}
            </span>
          </div>
          <div className="af-facts af-case-facts">
            {project.facts.map((fact) => (
              <div key={fact.value + fact.label.en}>
                <CountUpValue value={fact.value} />
                <span>{localize(fact.label, lang)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="af-section af-shell">
        <div className="af-story-list">
          {project.sections.map((section, idx) => (
            <article key={section.title.en} className="af-story-card">
              <span className="af-story-num">0{idx + 1}</span>
              <div>
                <p className="af-eyebrow">{localize(section.eyebrow, lang)}</p>
                <h2>{localize(section.title, lang)}</h2>
                <p>{localize(section.body, lang)}</p>
                {section.items && (
                  <ul className="af-story-bullets">
                    {section.items.map((item) => (
                      <li key={item.en}>
                        <CheckCircle2 size={16} />
                        <span>{localize(item, lang)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {project.workflow.length > 0 && (
        <section className="af-section af-band">
          <div className="af-shell">
            <p className="af-eyebrow">{lang === "en" ? "WORKFLOW" : "执行链路"}</p>
            <h2>{lang === "en" ? "How the system works end to end" : "端到端系统工作流"}</h2>
            <div className="af-cap-grid">
              {project.workflow.map((step) => (
                <article key={step.number} className="af-cap-card">
                  <span className="af-story-num">{step.number}</span>
                  <h3>{localize(step.title, lang)}</h3>
                  <p>{localize(step.text, lang)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="af-section af-shell">
        <div className="af-section-head">
          <div>
            <p className="af-eyebrow">{lang === "en" ? "NEXT CASES" : "继续查看"}</p>
            <h2>{lang === "en" ? "More case studies" : "更多项目案例"}</h2>
          </div>
          <span className="af-kbd-hint">{lang === "en" ? "← → to browse cases" : "← → 切换案例"}</span>
        </div>
        <div className="af-related-grid">
          {related.map((item) => (
            <Link key={item.slug} href={`/projects/${item.slug}`} className="af-related-card">
              <span className="af-card-cat">{localize(item.category, lang)}</span>
              <h3>{localize(item.title, lang)}</h3>
              <p>{localize(item.outcome, lang)}</p>
            </Link>
          ))}
        </div>
      </section>

      <ContactBand />
      <SiteFooter />
    </main>
  );
}

function NotFoundContent() {
  const { profile, lang, theme } = useApp();
  const { setCmdOpen, setChatOpen } = usePortfolioAI();
  const [pathname, setPathname] = useState("/unknown");

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setPathname(window.location.pathname || "/unknown"));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <main className={`af-page af-theme-${theme}`}>
      <SiteHeader casePage />
      <section className="af-shell af-not-found">
        <p className="af-eyebrow">ERROR 404</p>
        <h1>{lang === "en" ? "This page was eaten by an Agent. 🤖" : "这个页面被 Agent 吃掉了 🤖"}</h1>
        <div className="af-terminal-box">
          <code>$ agent.find(&quot;{pathname}&quot;) → 404 · tool_call failed · fallback: home</code>
        </div>
        <div className="af-actions">
          <Link className="af-btn af-btn-primary" href="/">
            <Home size={16} />
            <span>{lang === "en" ? "Back home" : "返回首页"}</span>
          </Link>
          <button type="button" className="af-btn af-btn-secondary" onClick={() => setCmdOpen(true)}>
            <Command size={16} />
            <span>{lang === "en" ? "Open ⌘K" : "打开 ⌘K"}</span>
          </button>
          {profile.ai.enabled && (
            <button type="button" className="af-btn af-btn-secondary" onClick={() => setChatOpen(true)}>
              <Sparkles size={16} />
              <span>{lang === "en" ? "Ask AI" : "问 AI"}</span>
            </button>
          )}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}

export function PortfolioHome({
  initialProfile,
  profileSlug,
  ownerRefCode,
  draftHandle,
  initialLang,
}: {
  initialProfile?: PortfolioProfile;
  profileSlug?: string;
  ownerRefCode?: string;
  draftHandle?: string;
  initialLang?: Lang;
} = {}) {
  return (
    <AppProvider
      initialProfile={initialProfile}
      profileSlug={profileSlug}
      ownerRefCode={ownerRefCode}
      initialLang={initialLang}
    >
      <HomeContent exportSlug={profileSlug === "__draft__" ? draftHandle : profileSlug} />
    </AppProvider>
  );
}

export function CaseStudyPage({ project }: { project: ProjectItem }) {
  return (
    <AppProvider>
      <CaseStudyContent project={project} />
    </AppProvider>
  );
}

export function NotFoundPage() {
  return (
    <AppProvider>
      <NotFoundContent />
    </AppProvider>
  );
}
