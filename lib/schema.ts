export type Lang = "en" | "zh";
export const AI_BRIEF_LIMITS = { expectedSalary: 160, availability: 160, workMode: 240, notes: 1000, redLines: 1000 } as const;
export type AiBrief = Partial<Record<keyof typeof AI_BRIEF_LIMITS, string>>;
export type ThemeId = "editorial" | "terminal" | "bento";
export type ProjectAccent = "mint" | "blue" | "coral" | "amber";

export interface LocalizedText {
  en: string;
  zh: string;
}

export interface ProfileFact {
  value: string;
  label: LocalizedText;
}

export interface ProjectSection {
  eyebrow: LocalizedText;
  title: LocalizedText;
  body: LocalizedText;
  items?: LocalizedText[];
}

export interface ProjectWorkflowStep {
  number: string;
  title: LocalizedText;
  text: LocalizedText;
}

export interface ProjectLink {
  label: LocalizedText;
  href: string;
}

export interface ProjectItem {
  slug: string;
  accent: ProjectAccent;
  group: "platform" | "enterprise" | "product";
  category: LocalizedText;
  title: LocalizedText;
  role: LocalizedText;
  summary: LocalizedText;
  outcome: LocalizedText;
  coverImage?: string;
  tags: string[];
  facts: ProfileFact[];
  links?: ProjectLink[];
  sections: ProjectSection[];
  workflow: ProjectWorkflowStep[];
}

export interface ExperienceItem {
  period: string;
  company: LocalizedText;
  role: LocalizedText;
  summary: LocalizedText;
}

export interface CapabilityItem {
  title: LocalizedText;
  summary: LocalizedText;
}

export type HeroStyle = "editorial-split" | "centered-minimal" | "sidebar-dossier" | "terminal-hero";
export type ProjectLayout = "card-grid" | "bento-grid" | "editorial-rows" | "timeline-cases";
export type FontPair = "sans-modern" | "serif-editorial" | "mono-tech";
export type SectionId = "work" | "capabilities" | "experience" | "contact";

export const DEFAULT_SECTION_ORDER: ReadonlyArray<SectionId> = ["work", "capabilities", "experience", "contact"];

export interface LayoutPlan {
  heroStyle?: HeroStyle;
  projectLayout?: ProjectLayout;
  fontPair?: FontPair;
  sectionOrder?: SectionId[];
}

export type BgPattern = "none" | "grid" | "dots" | "glow";
export type CardStyle = "elevated" | "glass" | "brutalist" | "minimal" | "neon";
export type ButtonStyle = "pill" | "sharp" | "solid";

export interface DesignTokens {
  accent?: string;
  accent2?: string;
  bg?: string;
  surface?: string;
  ink?: string;
  muted?: string;
  radius?: string;
  bgPattern?: BgPattern;
  cardStyle?: CardStyle;
  buttonStyle?: ButtonStyle;
}

export interface PortfolioProfile {
  theme: ThemeId;
  siteUrl: string;
  stylePrompt?: string;
  designTokens?: DesignTokens;
  layoutPlan?: LayoutPlan;
  renderMode?: "structured" | "custom";
  customHtml?: string;
  hideBranding?: boolean;
  basics: {
    name: LocalizedText;
    initials: string;
    role: LocalizedText;
    location: LocalizedText;
    timezone: string;
    email: string;
    avatar?: string;
    github?: string;
    linkedin?: string;
    wechat?: string;
    portfolio?: string;
    headline: LocalizedText;
    intro: LocalizedText;
    education: LocalizedText;
    footerNote: LocalizedText;
  };
  skills: string[];
  capabilities: CapabilityItem[];
  experiences: ExperienceItem[];
  projects: ProjectItem[];
  ai: {
    enabled: boolean;
    assistantName: LocalizedText;
    welcome: LocalizedText;
    suggestedPrompts: {
      en: string[];
      zh: string[];
    };
    stylePrompt?: string;
    guardrails?: string[];
  };
}

const VALID_BG_PATTERNS = new Set<BgPattern>(["none", "grid", "dots", "glow"]);
const VALID_CARD_STYLES = new Set<CardStyle>(["elevated", "glass", "brutalist", "minimal", "neon"]);
const VALID_BUTTON_STYLES = new Set<ButtonStyle>(["pill", "sharp", "solid"]);

export function sanitizeDesignTokens(raw: unknown): DesignTokens | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  const radiusRe = /^(?:0|[2-9]|1[0-9]|2[0-8])px$/;
  const out: DesignTokens = {};
  if (typeof obj.accent === "string" && hexRe.test(obj.accent.trim())) out.accent = obj.accent.trim();
  if (typeof obj.accent2 === "string" && hexRe.test(obj.accent2.trim())) out.accent2 = obj.accent2.trim();
  if (typeof obj.bg === "string" && hexRe.test(obj.bg.trim())) out.bg = obj.bg.trim();
  if (typeof obj.surface === "string" && hexRe.test(obj.surface.trim())) out.surface = obj.surface.trim();
  if (typeof obj.ink === "string" && hexRe.test(obj.ink.trim())) out.ink = obj.ink.trim();
  if (typeof obj.muted === "string" && hexRe.test(obj.muted.trim())) out.muted = obj.muted.trim();
  if (typeof obj.radius === "string" && radiusRe.test(obj.radius.trim())) out.radius = obj.radius.trim();
  if (typeof obj.bgPattern === "string" && VALID_BG_PATTERNS.has(obj.bgPattern as BgPattern)) {
    out.bgPattern = obj.bgPattern as BgPattern;
  }
  if (typeof obj.cardStyle === "string" && VALID_CARD_STYLES.has(obj.cardStyle as CardStyle)) {
    out.cardStyle = obj.cardStyle as CardStyle;
  }
  if (typeof obj.buttonStyle === "string" && VALID_BUTTON_STYLES.has(obj.buttonStyle as ButtonStyle)) {
    out.buttonStyle = obj.buttonStyle as ButtonStyle;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeCoverImage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const val = raw.trim();
  if (!val || val.length > 360_000) return undefined;
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(val)) return val;
  if (/^https:\/\/[^\s"'<>]+$/.test(val) && val.length <= 2048) return val;
  return undefined;
}

export function sanitizeCustomHtml(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let html = raw.trim();
  if (!html) return undefined;
  // Strip dangerous executable/embed tags and inline event handlers
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe\b[^>]*\/?>/gi, "")
    .replace(/<(?:object|embed|applet|base|meta\s+http-equiv\s*=\s*["']?refresh)\b[^>]*>[\s\S]*?<\/(?:object|embed|applet)>/gi, "")
    .replace(/<(?:object|embed|applet|base)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\1/gi, 'href="#"');
  if (html.length > 180_000) html = html.slice(0, 180_000);
  return html.trim() || undefined;
}

export interface StylePreset {
  id: string;
  label: LocalizedText;
  prompt: string;
  theme: ThemeId;
  designTokens: DesignTokens;
  layoutPlan: LayoutPlan;
}

export const STYLE_PRESETS: ReadonlyArray<StylePreset> = [
  {
    id: "apple-keynote",
    label: { en: "Apple Keynote", zh: "Apple 官网发布会风" },
    prompt: "Apple keynote product page aesthetic: deep obsidian black background, frosted glassmorphic cards, crisp white giant typography, subtle electric blue/cyan radial spotlight glow, ultra-clean spacing and pill CTAs.",
    theme: "terminal",
    designTokens: {
      accent: "#2997ff",
      accent2: "#6e6eff",
      bg: "#000000",
      surface: "#111318",
      ink: "#f5f5f7",
      muted: "#a1a1a6",
      radius: "22px",
      bgPattern: "glow",
      cardStyle: "glass",
      buttonStyle: "pill",
    },
    layoutPlan: {
      heroStyle: "centered-minimal",
      projectLayout: "bento-grid",
      fontPair: "sans-modern",
    },
  },
  {
    id: "retro-win95",
    label: { en: "Retro Win95", zh: "复古 Win95 桌面风" },
    prompt: "Nostalgic Windows 95 / classic 90s OS desktop aesthetic: iconic teal/silver palette, sharp 0px corners, beveled 3D window borders, crisp navy title bars, monospace system labels, and playful retro software craft.",
    theme: "editorial",
    designTokens: {
      accent: "#000080",
      accent2: "#008080",
      bg: "#c0c0c0",
      surface: "#dfdfdf",
      ink: "#000000",
      muted: "#333333",
      radius: "0px",
      bgPattern: "dots",
      cardStyle: "brutalist",
      buttonStyle: "sharp",
    },
    layoutPlan: {
      heroStyle: "terminal-hero",
      projectLayout: "card-grid",
      fontPair: "mono-tech",
    },
  },
  {
    id: "black-gold-arch",
    label: { en: "Black & Gold Monograph", zh: "黑金建筑画册风" },
    prompt: "Luxury black-and-gold architectural monograph aesthetic: matte charcoal canvas, warm champagne gold accents, high-contrast serif headlines, hairline golden dividers, editorial horizontal project rows with museum-grade whitespace.",
    theme: "terminal",
    designTokens: {
      accent: "#d4af37",
      accent2: "#b8860b",
      bg: "#0d0d0f",
      surface: "#16161a",
      ink: "#f4efe6",
      muted: "#a89f91",
      radius: "4px",
      bgPattern: "grid",
      cardStyle: "minimal",
      buttonStyle: "sharp",
    },
    layoutPlan: {
      heroStyle: "sidebar-dossier",
      projectLayout: "editorial-rows",
      fontPair: "serif-editorial",
    },
  },
  {
    id: "neo-brutalist",
    label: { en: "Neo-Brutalist Poster", zh: "新粗野主义海报风" },
    prompt: "Bold neo-brutalist graphic poster aesthetic: warm cream background, thick black ink borders, hard offset drop shadows, vivid vermilion/amber accents, punchy typography and unapologetic creative energy.",
    theme: "editorial",
    designTokens: {
      accent: "#e11d48",
      accent2: "#f59e0b",
      bg: "#fef9ef",
      surface: "#ffffff",
      ink: "#111111",
      muted: "#44403c",
      radius: "4px",
      bgPattern: "dots",
      cardStyle: "brutalist",
      buttonStyle: "sharp",
    },
    layoutPlan: {
      heroStyle: "editorial-split",
      projectLayout: "bento-grid",
      fontPair: "sans-modern",
    },
  },
  {
    id: "swiss-editorial",
    label: { en: "Swiss Magazine", zh: "瑞士极简杂志风" },
    prompt: "Swiss international typographic magazine aesthetic: gallery white canvas, crisp hairline rules, refined serif headings, terracotta/crimson editorial accent, clean sidebar dossier layout with calm hierarchy.",
    theme: "editorial",
    designTokens: {
      accent: "#b45309",
      accent2: "#9a3412",
      bg: "#faf8f5",
      surface: "#ffffff",
      ink: "#1c1917",
      muted: "#57534e",
      radius: "6px",
      bgPattern: "none",
      cardStyle: "minimal",
      buttonStyle: "solid",
    },
    layoutPlan: {
      heroStyle: "sidebar-dossier",
      projectLayout: "editorial-rows",
      fontPair: "serif-editorial",
    },
  },
  {
    id: "cyber-navy",
    label: { en: "Deep Navy Cyber", zh: "深海蓝科技风" },
    prompt: "Deep ocean navy engineering aesthetic: dark midnight slate background, glowing cyan/indigo neon borders, subtle technical grid backdrop, monospace metrics, ideal for AI/systems/full-stack engineers.",
    theme: "terminal",
    designTokens: {
      accent: "#38bdf8",
      accent2: "#818cf8",
      bg: "#070d19",
      surface: "#0f172a",
      ink: "#f1f5f9",
      muted: "#94a3b8",
      radius: "14px",
      bgPattern: "grid",
      cardStyle: "neon",
      buttonStyle: "pill",
    },
    layoutPlan: {
      heroStyle: "terminal-hero",
      projectLayout: "timeline-cases",
      fontPair: "mono-tech",
    },
  },
];

const VALID_HERO_STYLES = new Set<HeroStyle>(["editorial-split", "centered-minimal", "sidebar-dossier", "terminal-hero"]);
const VALID_PROJECT_LAYOUTS = new Set<ProjectLayout>(["card-grid", "bento-grid", "editorial-rows", "timeline-cases"]);
const VALID_FONT_PAIRS = new Set<FontPair>(["sans-modern", "serif-editorial", "mono-tech"]);
const VALID_SECTIONS = new Set<SectionId>(["work", "capabilities", "experience", "contact"]);

export function sanitizeLayoutPlan(raw: unknown): LayoutPlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const out: LayoutPlan = {};
  if (typeof obj.heroStyle === "string" && VALID_HERO_STYLES.has(obj.heroStyle as HeroStyle)) {
    out.heroStyle = obj.heroStyle as HeroStyle;
  }
  if (typeof obj.projectLayout === "string" && VALID_PROJECT_LAYOUTS.has(obj.projectLayout as ProjectLayout)) {
    out.projectLayout = obj.projectLayout as ProjectLayout;
  }
  if (typeof obj.fontPair === "string" && VALID_FONT_PAIRS.has(obj.fontPair as FontPair)) {
    out.fontPair = obj.fontPair as FontPair;
  }
  if (Array.isArray(obj.sectionOrder)) {
    const seen = new Set<SectionId>();
    const order: SectionId[] = [];
    for (const item of obj.sectionOrder) {
      if (typeof item === "string" && VALID_SECTIONS.has(item as SectionId) && !seen.has(item as SectionId)) {
        seen.add(item as SectionId);
        order.push(item as SectionId);
      }
    }
    for (const fallback of DEFAULT_SECTION_ORDER) {
      if (!seen.has(fallback)) order.push(fallback);
    }
    if (order.length === DEFAULT_SECTION_ORDER.length) {
      out.sectionOrder = order;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const HERO_STYLE_OPTIONS: ReadonlyArray<{ id: HeroStyle; label: LocalizedText }> = [
  { id: "editorial-split", label: { en: "Editorial Split", zh: "左右分栏" } },
  { id: "centered-minimal", label: { en: "Centered Minimal", zh: "居中极简" } },
  { id: "sidebar-dossier", label: { en: "Sidebar Dossier", zh: "左栏档案" } },
  { id: "terminal-hero", label: { en: "Terminal Tech", zh: "极客终端" } },
];

export const PROJECT_LAYOUT_OPTIONS: ReadonlyArray<{ id: ProjectLayout; label: LocalizedText }> = [
  { id: "bento-grid", label: { en: "Bento Grid", zh: "错落 Bento" } },
  { id: "editorial-rows", label: { en: "Editorial Rows", zh: "杂志横排" } },
  { id: "timeline-cases", label: { en: "Timeline Cases", zh: "时间轴流" } },
  { id: "card-grid", label: { en: "Card Grid", zh: "经典卡片" } },
];

export const FONT_PAIR_OPTIONS: ReadonlyArray<{ id: FontPair; label: LocalizedText }> = [
  { id: "sans-modern", label: { en: "Modern Sans", zh: "现代无衬线" } },
  { id: "serif-editorial", label: { en: "Editorial Serif", zh: "文艺衬线" } },
  { id: "mono-tech", label: { en: "Tech Mono", zh: "极客等宽" } },
];

export const THEMES: ReadonlyArray<{
  id: ThemeId;
  label: LocalizedText;
  description: LocalizedText;
}> = [
  {
    id: "editorial",
    label: { en: "Editorial", zh: "编辑风" },
    description: {
      en: "Warm ivory paper, crisp ink, emerald accents",
      zh: "暖白纸感、高对比墨色与祖母绿点缀",
    },
  },
  {
    id: "terminal",
    label: { en: "Terminal", zh: "极客暗黑" },
    description: {
      en: "Obsidian dark canvas, phosphor green, monospace craft",
      zh: "曜石黑底、荧光绿高亮与等宽终端风格",
    },
  },
  {
    id: "bento",
    label: { en: "Bento", zh: "Bento 网格" },
    description: {
      en: "Modern rounded bento cards, vivid indigo-blue accents",
      zh: "现代圆角卡片网格与蓝紫渐变点缀",
    },
  },
];

export function localize(text: LocalizedText | string | undefined, lang: Lang): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[lang] || text.en || text.zh || "";
}

export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function isValidTheme(value: unknown): value is ThemeId {
  return value === "editorial" || value === "terminal" || value === "bento";
}
