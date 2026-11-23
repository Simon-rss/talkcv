export type Lang = "en" | "zh";
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

export interface PortfolioProfile {
  theme: ThemeId;
  siteUrl: string;
  basics: {
    name: LocalizedText;
    initials: string;
    role: LocalizedText;
    location: LocalizedText;
    timezone: string;
    email: string;
    github?: string;
    linkedin?: string;
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
    guardrails?: string[];
  };
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

export function isValidTheme(value: unknown): value is ThemeId {
  return value === "editorial" || value === "terminal" || value === "bento";
}
