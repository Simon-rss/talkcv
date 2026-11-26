/**
 * Shared A4 PDF Resume schema, sanitizer, default builder, and 4 designer-grade HTML/CSS templates.
 * Plain ESM (.mjs) so both browser Studio preview, Worker AI endpoint, and Node.js Chromium PDF renderer share one source of truth.
 */

export const RESUME_PDF_TEMPLATES = [
  {
    id: "ats-clean",
    label: { zh: "大厂 ATS 单栏", en: "Big-Tech ATS Clean" },
    desc: { zh: "经典高密度单栏，招聘系统解析率最高", en: "Classic single-column, highest ATS parseability" },
    defaultAccent: "#1d4ed8",
  },
  {
    id: "modern-sidebar",
    label: { zh: "现代双栏侧边栏", en: "Modern Sidebar" },
    desc: { zh: "左侧技能与联系栏，右侧主叙事，层次分明", en: "Left contact & skills rail with structured main column" },
    defaultAccent: "#0f766e",
  },
  {
    id: "editorial-magazine",
    label: { zh: "产品/设计杂志风", en: "Editorial Magazine" },
    desc: { zh: "精致顶部色条、留白与指标卡片，高级感拉满", en: "Refined editorial header, accent rules & metric strips" },
    defaultAccent: "#b45309",
  },
  {
    id: "tech-dossier",
    label: { zh: "极客技术档案", en: "Tech Dossier" },
    desc: { zh: "等宽技术标签 + 量化指标高亮，研发/AI 首选", en: "Monospace badges & highlighted metrics for engineers" },
    defaultAccent: "#4338ca",
  },
];

export const RESUME_PDF_ACCENTS = [
  { hex: "#1d4ed8", label: { zh: "商务蓝", en: "Cobalt" } },
  { hex: "#0f766e", label: { zh: "松石绿", en: "Teal" } },
  { hex: "#111827", label: { zh: "曜石黑", en: "Obsidian" } },
  { hex: "#4338ca", label: { zh: "靛青蓝", en: "Indigo" } },
  { hex: "#b45309", label: { zh: "琥珀棕", en: "Amber" } },
  { hex: "#be123c", label: { zh: "酒红", en: "Crimson" } },
];

const VALID_TEMPLATES = new Set(RESUME_PDF_TEMPLATES.map((t) => t.id));
const VALID_DENSITIES = new Set(["compact", "balanced", "spacious"]);
const DEFAULT_SECTIONS = ["summary", "skills", "experience", "projects", "education"];
const VALID_SECTIONS = new Set(DEFAULT_SECTIONS);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function pickText(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field.trim();
  if (typeof field === "object") {
    const primary = lang === "zh" ? field.zh : field.en;
    const secondary = lang === "zh" ? field.en : field.zh;
    return String(primary || secondary || "").trim();
  }
  return "";
}

function cleanStr(val, max = 400) {
  if (typeof val !== "string") return "";
  return val.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(arr, maxItems = 12, maxLen = 220) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => cleanStr(typeof v === "string" ? v : "", maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function profileToDefaultResumePdfPlan(profile, lang = "zh", options = {}) {
  const basics = profile?.basics ?? {};
  const zh = lang === "zh";
  const contacts = [
    pickText(basics.location, lang),
    cleanStr(basics.email, 120),
    basics.wechat ? `${zh ? "微信" : "WeChat"}: ${cleanStr(basics.wechat, 60)}` : "",
    cleanStr(basics.github, 160),
    cleanStr(basics.linkedin, 160),
    cleanStr(basics.portfolio, 160),
  ].filter(Boolean);

  const experiences = Array.isArray(profile?.experiences)
    ? profile.experiences.slice(0, 6).map((exp) => {
        const rawSummary = pickText(exp?.summary, lang);
        const bullets = rawSummary
          .split(/[；;。\n]+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 4)
          .slice(0, 4);
        return {
          company: pickText(exp?.company, lang),
          role: pickText(exp?.role, lang),
          period: cleanStr(exp?.period, 60),
          bullets: bullets.length > 0 ? bullets : rawSummary ? [rawSummary] : [],
        };
      }).filter((e) => e.company || e.role)
    : [];

  const projects = Array.isArray(profile?.projects)
    ? profile.projects.slice(0, 5).map((p) => {
        const summary = pickText(p?.summary, lang);
        const outcome = pickText(p?.outcome, lang);
        const metrics = Array.isArray(p?.facts)
          ? p.facts
              .slice(0, 4)
              .map((f) => `${cleanStr(f?.value, 32)} ${pickText(f?.label, lang)}`.trim())
              .filter(Boolean)
          : [];
        const sectionBullets = Array.isArray(p?.sections)
          ? p.sections
              .flatMap((sec) => (Array.isArray(sec?.items) ? sec.items : []))
              .map((item) => pickText(item, lang))
              .filter(Boolean)
              .slice(0, 3)
          : [];
        const bullets = [...sectionBullets];
        if (outcome && !bullets.some((b) => b.includes(outcome.slice(0, 12)))) {
          bullets.unshift(outcome);
        }
        return {
          title: pickText(p?.title, lang),
          role: pickText(p?.role, lang),
          period: cleanStr(p?.period, 60),
          summary,
          metrics,
          bullets: bullets.slice(0, 4),
        };
      }).filter((p) => p.title)
    : [];

  const targetPages = options.targetPages === 2 ? 2 : 1;
  const template = VALID_TEMPLATES.has(options.template) ? options.template : "ats-clean";
  const accentFromProfile = typeof profile?.designTokens?.accent === "string" && HEX_RE.test(profile.designTokens.accent)
    ? profile.designTokens.accent
    : RESUME_PDF_TEMPLATES.find((t) => t.id === template)?.defaultAccent || "#1d4ed8";

  return {
    template,
    accentColor: options.accentColor && HEX_RE.test(options.accentColor) ? options.accentColor : accentFromProfile,
    targetPages,
    density: targetPages === 1 ? "compact" : "balanced",
    sectionOrder: [...DEFAULT_SECTIONS],
    showQr: options.showQr !== false,
    lang: lang === "en" ? "en" : "zh",
    name: pickText(basics.name, lang) || (zh ? "候选人" : "Candidate"),
    role: pickText(basics.role, lang),
    headline: pickText(basics.headline, lang),
    summary: pickText(basics.intro, lang),
    contacts,
    skills: cleanList(profile?.skills, 18, 48),
    experiences,
    projects,
    education: pickText(basics.education, lang),
    aiNote: "",
  };
}

export function sanitizeResumePdfPlan(raw, fallback) {
  const base = fallback && typeof fallback === "object" ? fallback : {
    template: "ats-clean",
    accentColor: "#1d4ed8",
    targetPages: 1,
    density: "compact",
    sectionOrder: [...DEFAULT_SECTIONS],
    showQr: true,
    lang: "zh",
    name: "Candidate",
    role: "",
    headline: "",
    summary: "",
    contacts: [],
    skills: [],
    experiences: [],
    projects: [],
    education: "",
    aiNote: "",
  };
  if (!raw || typeof raw !== "object") return { ...base };

  const template = VALID_TEMPLATES.has(raw.template) ? raw.template : base.template;
  const accentColor = typeof raw.accentColor === "string" && HEX_RE.test(raw.accentColor.trim())
    ? raw.accentColor.trim()
    : base.accentColor;
  const targetPages = raw.targetPages === 2 ? 2 : raw.targetPages === 1 ? 1 : base.targetPages;
  const density = VALID_DENSITIES.has(raw.density) ? raw.density : base.density;
  const lang = raw.lang === "en" || raw.lang === "zh" ? raw.lang : base.lang;

  let sectionOrder = [...base.sectionOrder];
  if (Array.isArray(raw.sectionOrder)) {
    const seen = new Set();
    const next = [];
    for (const item of raw.sectionOrder) {
      if (typeof item === "string" && VALID_SECTIONS.has(item) && !seen.has(item)) {
        seen.add(item);
        next.push(item);
      }
    }
    for (const s of DEFAULT_SECTIONS) {
      if (!seen.has(s)) next.push(s);
    }
    sectionOrder = next;
  }

  const experiences = Array.isArray(raw.experiences)
    ? raw.experiences
        .slice(0, 8)
        .map((e) => ({
          company: cleanStr(e?.company, 100),
          role: cleanStr(e?.role, 100),
          period: cleanStr(e?.period, 60),
          bullets: cleanList(e?.bullets, 5, 260),
        }))
        .filter((e) => e.company || e.role)
    : base.experiences;

  const projects = Array.isArray(raw.projects)
    ? raw.projects
        .slice(0, 6)
        .map((p) => ({
          title: cleanStr(p?.title, 120),
          role: cleanStr(p?.role, 80),
          period: cleanStr(p?.period, 60),
          summary: cleanStr(p?.summary, 300),
          metrics: cleanList(p?.metrics, 5, 64),
          bullets: cleanList(p?.bullets, 5, 260),
        }))
        .filter((p) => p.title)
    : base.projects;

  return {
    template,
    accentColor,
    targetPages,
    density,
    sectionOrder,
    showQr: typeof raw.showQr === "boolean" ? raw.showQr : base.showQr,
    lang,
    fitScale:
      typeof raw.fitScale === "number" && Number.isFinite(raw.fitScale)
        ? Math.min(1, Math.max(0.72, Number(raw.fitScale.toFixed(3))))
        : 1,
    name: cleanStr(raw.name, 80) || base.name,
    role: cleanStr(raw.role, 120) || base.role,
    headline: cleanStr(raw.headline, 200),
    summary: cleanStr(raw.summary, 500),
    contacts: Array.isArray(raw.contacts) ? cleanList(raw.contacts, 8, 160) : base.contacts,
    skills: Array.isArray(raw.skills) ? cleanList(raw.skills, 20, 48) : base.skills,
    experiences,
    projects,
    education: cleanStr(raw.education, 300),
    aiNote: cleanStr(raw.aiNote, 240),
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeImageSrc(src) {
  if (typeof src !== "string") return "";
  const trimmed = src.trim();
  if (/^data:image\/(?:png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) return trimmed;
  if (/^https:\/\/[^\s"'<>]+$/.test(trimmed) && trimmed.length <= 2048) return trimmed;
  return "";
}

export function renderResumePdfHtml(rawPlan, options = {}) {
  const plan = sanitizeResumePdfPlan(rawPlan);
  const zh = plan.lang === "zh";
  const qrSrc = plan.showQr ? safeImageSrc(options.qrDataUrl) : "";
  const siteUrl = cleanStr(options.siteUrl, 180);
  const avatarSrc = safeImageSrc(options.avatarUrl);
  const scale = typeof plan.fitScale === "number" && plan.fitScale >= 0.72 && plan.fitScale <= 1 ? plan.fitScale : 1;

  // Automatically include the candidate's TalkCV interactive resume URL in contacts (deduplicated)
  const displaySite = siteUrl ? siteUrl.replace(/^https?:\/\//, "") : "";
  const hasSiteInContacts = displaySite
    ? plan.contacts.some((c) => c.toLowerCase().includes(displaySite.toLowerCase()))
    : true;
  const headerContacts = [
    ...plan.contacts.map((c) => ({ text: c, href: /^https?:\/\//i.test(c) ? c : "" })),
    ...(!hasSiteInContacts && siteUrl ? [{ text: `${zh ? "在线交互简历" : "Interactive CV"}: ${displaySite}`, href: siteUrl }] : []),
  ];

  const labels = zh
    ? {
        summary: "个人简介",
        skills: "核心技能",
        experience: "工作经历",
        projects: "核心项目",
        education: "教育背景",
        qrTitle: "扫码对话我的 AI 分身",
        qrSub: "3秒测 JD 匹配 · 追问项目细节",
      }
    : {
        summary: "Profile",
        skills: "Core Skills",
        experience: "Experience",
        projects: "Selected Projects",
        education: "Education",
        qrTitle: "Scan to Ask My AI Twin",
        qrSub: "Instant JD match & project deep-dive",
      };

  const baseSpacing =
    plan.density === "compact"
      ? { padY: 11, padX: 13, fs: 9.4, lh: 1.42, gapSec: 9, gapEntry: 6.5, h1: 19, h2: 10 }
      : plan.density === "spacious"
        ? { padY: 15, padX: 15.5, fs: 10.2, lh: 1.54, gapSec: 14, gapEntry: 9.5, h1: 22, h2: 10.8 }
        : { padY: 13, padX: 14.5, fs: 9.8, lh: 1.48, gapSec: 11.5, gapEntry: 8, h1: 20.5, h2: 10.4 };
  const s = (v, unit) => `${(v * scale).toFixed(2)}${unit}`;
  const spacing = {
    padY: s(baseSpacing.padY, "mm"),
    padX: `${baseSpacing.padX}mm`,
    fs: s(baseSpacing.fs, "pt"),
    lh: (baseSpacing.lh - (1 - scale) * 0.25).toFixed(2),
    gapSec: s(baseSpacing.gapSec, "pt"),
    gapEntry: s(baseSpacing.gapEntry, "pt"),
    h1: s(baseSpacing.h1, "pt"),
    h2: s(baseSpacing.h2, "pt"),
  };

  const qrBlock = qrSrc
    ? `<div class="qr-box">
        <img src="${qrSrc}" alt="AI QR" width="66" height="66" />
        <div class="qr-text">
          <strong>${esc(labels.qrTitle)}</strong>
          <span>${esc(labels.qrSub)}</span>
          ${siteUrl ? `<code>${esc(siteUrl.replace(/^https?:\/\//, ""))}</code>` : ""}
        </div>
      </div>`
    : "";

  const renderSection = (id) => {
    if (id === "summary") {
      if (!plan.summary && !plan.headline) return "";
      return `<section class="sec sec-summary">
        <h2>${esc(labels.summary)}</h2>
        ${plan.headline ? `<p class="headline">${esc(plan.headline)}</p>` : ""}
        ${plan.summary ? `<p class="body-text">${esc(plan.summary)}</p>` : ""}
      </section>`;
    }
    if (id === "skills") {
      if (!plan.skills.length) return "";
      const items =
        plan.template === "ats-clean"
          ? `<p class="skills-inline">${plan.skills.map((s) => esc(s)).join(" · ")}</p>`
          : `<div class="skills-tags">${plan.skills.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>`;
      return `<section class="sec sec-skills">
        <h2>${esc(labels.skills)}</h2>
        ${items}
      </section>`;
    }
    if (id === "experience") {
      if (!plan.experiences.length) return "";
      return `<section class="sec sec-exp">
        <h2>${esc(labels.experience)}</h2>
        ${plan.experiences
          .map(
            (e) => `<article class="entry">
              <div class="entry-head">
                <div class="entry-title">
                  <strong>${esc(e.company)}</strong>
                  ${e.role ? `<span class="sep">·</span><span class="entry-role">${esc(e.role)}</span>` : ""}
                </div>
                ${e.period ? `<span class="period">${esc(e.period)}</span>` : ""}
              </div>
              ${
                e.bullets.length
                  ? `<ul class="bullets">${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
                  : ""
              }
            </article>`,
          )
          .join("")}
      </section>`;
    }
    if (id === "projects") {
      if (!plan.projects.length) return "";
      return `<section class="sec sec-proj">
        <h2>${esc(labels.projects)}</h2>
        ${plan.projects
          .map(
            (p) => `<article class="entry proj-entry">
              <div class="entry-head">
                <div class="entry-title">
                  <strong>${esc(p.title)}</strong>
                  ${p.role ? `<span class="sep">·</span><span class="entry-role">${esc(p.role)}</span>` : ""}
                </div>
                ${p.period ? `<span class="period">${esc(p.period)}</span>` : ""}
              </div>
              ${p.summary ? `<p class="entry-summary">${esc(p.summary)}</p>` : ""}
              ${
                p.metrics.length
                  ? `<div class="metrics">${p.metrics.map((m) => `<span class="metric">${esc(m)}</span>`).join("")}</div>`
                  : ""
              }
              ${
                p.bullets.length
                  ? `<ul class="bullets">${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
                  : ""
              }
            </article>`,
          )
          .join("")}
      </section>`;
    }
    if (id === "education") {
      if (!plan.education) return "";
      return `<section class="sec sec-edu">
        <h2>${esc(labels.education)}</h2>
        <p class="body-text">${esc(plan.education)}</p>
      </section>`;
    }
    return "";
  };

  let bodyHtml = "";
  if (plan.template === "modern-sidebar") {
    const railSections = ["skills", "education"];
    const mainSections = plan.sectionOrder.filter((s) => !railSections.includes(s));
    bodyHtml = `
      <div class="sidebar-layout">
        <aside class="rail">
          ${avatarSrc ? `<img class="avatar" src="${avatarSrc}" alt="${esc(plan.name)}" />` : `<div class="avatar-fallback">${esc(plan.name.slice(0, 2).toUpperCase())}</div>`}
          <h1 class="name">${esc(plan.name)}</h1>
          ${plan.role ? `<p class="role">${esc(plan.role)}</p>` : ""}
          ${
            headerContacts.length
              ? `<div class="rail-contacts">${headerContacts
                  .map((c) =>
                    c.href
                      ? `<div><a class="contact-link" href="${esc(c.href)}">${esc(c.text)}</a></div>`
                      : `<div>${esc(c.text)}</div>`,
                  )
                  .join("")}</div>`
              : ""
          }
          ${railSections.map(renderSection).join("")}
          ${qrBlock}
        </aside>
        <main class="main-col">
          ${mainSections.map(renderSection).join("")}
        </main>
      </div>`;
  } else {
    bodyHtml = `
      <header class="doc-header">
        <div class="header-left">
          <div class="name-row">
            ${avatarSrc && plan.template === "editorial-magazine" ? `<img class="avatar-sm" src="${avatarSrc}" alt="${esc(plan.name)}" />` : ""}
            <div>
              <h1 class="name">${esc(plan.name)}</h1>
              ${plan.role ? `<p class="role">${esc(plan.role)}</p>` : ""}
            </div>
          </div>
          ${
            headerContacts.length
              ? `<p class="contacts">${headerContacts
                  .map((c) =>
                    c.href
                      ? `<a class="contact-link" href="${esc(c.href)}">${esc(c.text)}</a>`
                      : `<span>${esc(c.text)}</span>`,
                  )
                  .join('<span class="dot">·</span>')}</p>`
              : ""
          }
        </div>
        ${qrBlock}
      </header>
      <main class="doc-main">
        ${plan.sectionOrder.map(renderSection).join("")}
      </main>`;
  }

  return `<!DOCTYPE html>
<html lang="${plan.lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(plan.name)} - Resume</title>
<style>
  :root {
    --accent: ${plan.accentColor};
    --ink: #0f172a;
    --ink-soft: #334155;
    --muted: #64748b;
    --line: #e2e8f0;
    --tint: color-mix(in srgb, var(--accent) 8%, #ffffff);
    --pad-y: ${spacing.padY};
    --pad-x: ${spacing.padX};
    --fs: ${spacing.fs};
    --lh: ${spacing.lh};
    --gap-sec: ${spacing.gapSec};
    --gap-entry: ${spacing.gapEntry};
    --h1: ${spacing.h1};
    --h2: ${spacing.h2};
  }
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: var(--ink);
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: var(--fs);
    line-height: var(--lh);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: #ffffff;
    padding: var(--pad-y) var(--pad-x);
  }
  .page.tpl-modern-sidebar {
    padding: 0;
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12pt;
    padding-bottom: 10pt;
    border-bottom: 1.5pt solid var(--ink);
    margin-bottom: var(--gap-sec);
  }
  .name-row { display: flex; align-items: center; gap: 10pt; }
  .name {
    margin: 0;
    font-size: var(--h1);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--ink);
  }
  .role {
    margin: 3pt 0 0;
    font-size: 10.5pt;
    font-weight: 600;
    color: var(--accent);
  }
  .contacts {
    margin: 6pt 0 0;
    font-size: 8.6pt;
    color: var(--ink-soft);
    display: flex;
    flex-wrap: wrap;
    gap: 3pt 6pt;
    line-height: 1.35;
  }
  .contact-link { color: var(--accent); text-decoration: none; font-weight: 600; }
  .tpl-tech-dossier .contact-link { color: #93c5fd; }
  .dot { color: #cbd5e1; }
  .qr-box {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 7pt;
    padding: 5pt 7pt;
    border: 1pt solid var(--line);
    border-radius: 6pt;
    background: var(--tint);
  }
  .qr-box img { display: block; width: 46pt; height: 46pt; border-radius: 3pt; background: #fff; padding: 2pt; }
  .qr-text { display: flex; flex-direction: column; gap: 1.5pt; max-width: 104pt; }
  .qr-text strong { font-size: 7.8pt; color: var(--ink); line-height: 1.25; }
  .qr-text span { font-size: 7pt; color: var(--ink-soft); line-height: 1.25; }
  .qr-text code { font-size: 6.6pt; color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
  .sec { margin-bottom: var(--gap-sec); }
  .sec h2 {
    margin: 0 0 5.5pt;
    font-size: var(--h2);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    padding-bottom: 3pt;
    border-bottom: 1pt solid var(--line);
  }
  .headline { margin: 0 0 3pt; font-weight: 700; color: var(--ink); }
  .body-text { margin: 0; color: var(--ink-soft); }
  .skills-inline { margin: 0; color: var(--ink-soft); }
  .skills-tags { display: flex; flex-wrap: wrap; gap: 4pt; }
  .tag {
    display: inline-block;
    padding: 2pt 6pt;
    border-radius: 4pt;
    background: var(--tint);
    border: 0.75pt solid color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--ink);
    font-size: 8.4pt;
    font-weight: 500;
  }
  .entry {
    margin-bottom: var(--gap-entry);
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .entry:last-child { margin-bottom: 0; }
  .entry-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8pt;
  }
  .entry-title { font-size: 9.8pt; color: var(--ink); }
  .entry-title strong { font-weight: 700; }
  .sep { margin: 0 4pt; color: #94a3b8; }
  .entry-role { font-weight: 600; color: var(--ink-soft); }
  .period { flex: 0 0 auto; font-size: 8.4pt; color: var(--muted); font-variant-numeric: tabular-nums; }
  .entry-summary { margin: 2.5pt 0 3pt; color: var(--ink-soft); }
  .metrics { display: flex; flex-wrap: wrap; gap: 4pt; margin: 3pt 0 4pt; }
  .metric {
    font-size: 8pt;
    font-weight: 600;
    color: var(--accent);
    background: var(--tint);
    padding: 1.5pt 5.5pt;
    border-radius: 3pt;
  }
  .bullets { margin: 3pt 0 0; padding-left: 13pt; color: var(--ink-soft); }
  .bullets li { margin-bottom: 2pt; }
  .bullets li:last-child { margin-bottom: 0; }

  /* Template 2: Modern Sidebar */
  .sidebar-layout {
    display: grid;
    grid-template-columns: 64mm 1fr;
    min-height: 297mm;
  }
  .rail {
    background: color-mix(in srgb, var(--accent) 7%, #f8fafc);
    border-right: 1pt solid var(--line);
    padding: var(--pad-y) 9mm;
    display: flex;
    flex-direction: column;
    gap: 10pt;
  }
  .rail .avatar, .rail .avatar-fallback {
    width: 48pt;
    height: 48pt;
    border-radius: 10pt;
    object-fit: cover;
  }
  .rail .avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #fff;
    font-weight: 800;
    font-size: 16pt;
  }
  .rail .name { font-size: 17pt; }
  .rail-contacts {
    display: flex;
    flex-direction: column;
    gap: 3pt;
    font-size: 8.2pt;
    color: var(--ink-soft);
    word-break: break-word;
    padding-bottom: 8pt;
    border-bottom: 1pt solid var(--line);
  }
  .rail .sec { margin-bottom: 4pt; }
  .rail .qr-box { flex-direction: column; align-items: flex-start; margin-top: auto; }
  .main-col { padding: var(--pad-y) var(--pad-x) var(--pad-y) 11mm; }

  /* Template 3: Editorial Magazine */
  .tpl-editorial-magazine {
    border-top: 5pt solid var(--accent);
  }
  .tpl-editorial-magazine .doc-header {
    border-bottom: 1pt solid var(--line);
    padding-bottom: 11pt;
  }
  .avatar-sm { width: 42pt; height: 42pt; border-radius: 999px; object-fit: cover; border: 1.5pt solid var(--accent); }
  .tpl-editorial-magazine .sec h2 {
    border-bottom: none;
    padding-left: 7pt;
    border-left: 3pt solid var(--accent);
    padding-bottom: 0;
  }
  .tpl-editorial-magazine .proj-entry {
    padding: 6pt 8pt;
    border-radius: 5pt;
    background: #fafafa;
    border: 0.75pt solid var(--line);
  }

  /* Template 4: Tech Dossier */
  .tpl-tech-dossier .doc-header {
    background: #0f172a;
    color: #f8fafc;
    margin: calc(var(--pad-y) * -1) calc(var(--pad-x) * -1) var(--gap-sec);
    padding: 12mm var(--pad-x) 10mm;
    border-bottom: 3pt solid var(--accent);
  }
  .tpl-tech-dossier .name { color: #ffffff; }
  .tpl-tech-dossier .role { color: color-mix(in srgb, var(--accent) 45%, #ffffff); }
  .tpl-tech-dossier .contacts { color: #cbd5e1; }
  .tpl-tech-dossier .qr-box { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }
  .tpl-tech-dossier .qr-text strong { color: #ffffff; }
  .tpl-tech-dossier .qr-text span { color: #cbd5e1; }
  .tpl-tech-dossier .qr-text code { color: #93c5fd; }
  .tpl-tech-dossier .tag, .tpl-tech-dossier .period, .tpl-tech-dossier .metric {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .tpl-tech-dossier .sec h2 {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    border-bottom: 1.2pt dashed var(--line);
  }
</style>
</head>
<body>
  <div class="page tpl-${esc(plan.template)}">
    ${bodyHtml}
  </div>
</body>
</html>`;
}
