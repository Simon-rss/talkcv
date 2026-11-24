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
