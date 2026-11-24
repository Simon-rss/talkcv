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

export interface DesignTokens {
  accent?: string;
  bg?: string;
  surface?: string;
  radius?: string;
}

export interface PortfolioProfile {
  theme: ThemeId;
  siteUrl: string;
  stylePrompt?: string;
  designTokens?: DesignTokens;
  layoutPlan?: LayoutPlan;
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

export function sanitizeDesignTokens(raw: unknown): DesignTokens | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  const radiusRe = /^(?:0|[4-9]|1[0-9]|2[0-8])px$/;
  const out: DesignTokens = {};
  if (typeof obj.accent === "string" && hexRe.test(obj.accent.trim())) out.accent = obj.accent.trim();
  if (typeof obj.bg === "string" && hexRe.test(obj.bg.trim())) out.bg = obj.bg.trim();
  if (typeof obj.surface === "string" && hexRe.test(obj.surface.trim())) out.surface = obj.surface.trim();
  if (typeof obj.radius === "string" && radiusRe.test(obj.radius.trim())) out.radius = obj.radius.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

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
