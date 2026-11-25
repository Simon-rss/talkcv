import type { PortfolioProfile } from "./schema";

export const PM_SAMPLE_PROFILE: PortfolioProfile = {
  theme: "editorial",
  siteUrl: "https://mytalkcv.com",
  designTokens: {
    accent: "#0071e3",
    accent2: "#5e5ce6",
    bg: "#f5f5f7",
    surface: "#ffffff",
    ink: "#1d1d1f",
    muted: "#6e6e73",
    radius: "20px",
    bgPattern: "glow",
    cardStyle: "glass",
    buttonStyle: "pill",
  },
  layoutPlan: {
    heroStyle: "editorial-split",
    projectLayout: "bento-grid",
    fontPair: "sans-modern",
    sectionOrder: ["work", "capabilities", "experience", "contact"],
  },
  basics: {
    name: { en: "Lin Wei (Sample)", zh: "林薇（产品经理样板）" },
    initials: "LW",
    role: { en: "Senior AI Product Manager · Growth & SaaS", zh: "高级 AI 产品经理 · 商业化与增长" },
    location: { en: "Shanghai, China", zh: "上海" },
    timezone: "Asia/Shanghai",
    email: "hi@mytalkcv.com",
    headline: {
      en: "Turning ambiguous AI capabilities into high-retention B2B & consumer workflows.",
      zh: "把前沿 AI 能力打磨成高留存、可付费的真实用户工作流。",
    },
    intro: {
      en: "6 years across SaaS onboarding, pricing experimentation, and AI copilot UX. Sample showcase demonstrating how a Product Manager's portfolio looks on TalkCV.",
      zh: "6 年 SaaS 增长与 AI 产品经验，擅长冷启动漏斗优化、定价体系设计与跨团队交付。此为 TalkCV 产品经理角色演示样板。",
    },
    education: { en: "M.A. in Interactive Media & Management", zh: "交互媒体与管理 · 硕士" },
    footerNote: { en: "Sample PM Showcase on TalkCV", zh: "TalkCV 产品经理演示样板" },
  },
  skills: ["AI Product Strategy", "PLG & Pricing", "Funnel Analytics", "SQL", "Figma", "0→1 Launch"],
  capabilities: [
    {
      title: { en: "PLG Onboarding & Activation", zh: "PLG 冷启动与激活增长" },
      summary: {
        en: "Redesigned zero-login try-before-signup funnels, lifting day-1 activation by 42%.",
        zh: "重构免登录前置体验漏斗，首日核心功能激活率提升 42%。",
      },
    },
    {
      title: { en: "Commercialization & Pricing", zh: "商业化与订阅定价设计" },
      summary: {
        en: "Launched tiered credits + annual pass pricing, growing net dollar retention to 118%.",
        zh: "搭建分层点数与年付通行证体系，净金额留存率提升至 118%。",
      },
    },
  ],
  experiences: [
    {
      period: "2023.06 – Present",
      company: { en: "Cloud Collaboration SaaS", zh: "云端协同 SaaS 平台" },
      role: { en: "Senior AI Product Manager", zh: "高级 AI 产品经理" },
      summary: {
        en: "Owned AI writing & workspace assistant from 0 to 120k MAU with 6.8% free-to-paid conversion.",
        zh: "从 0 到 1 负责 AI 工作台助手，做到 12 万月活与 6.8% 免费转付费率。",
      },
    },
  ],
  projects: [
    {
      slug: "pm-ai-onboarding-funnel",
      accent: "blue",
      group: "product",
      category: { en: "Growth · PLG", zh: "增长 · PLG" },
      title: { en: "Zero-Friction AI Workspace Onboarding", zh: "免登录 AI 工作台冷启动重构" },
      role: { en: "Product Lead", zh: "产品负责人" },
      summary: {
        en: "Replaced mandatory signup walls with instant sample templates and live preview, boosting activation by 42%.",
        zh: "用一键示例与实时预览替代强制登录墙，核心首日激活率提升 42%。",
      },
      outcome: { en: "+42% activation, +28% paid conversion", zh: "激活率 +42%，付费转化 +28%" },
      tags: ["PLG", "Onboarding", "A/B Testing"],
      facts: [
        { value: "+42%", label: { en: "D1 Activation", zh: "首日激活提升" } },
        { value: "6.8%", label: { en: "Paid Conversion", zh: "免费转付费" } },
        { value: "120K", label: { en: "Monthly Active", zh: "月活跃用户" } },
      ],
      sections: [],
      workflow: [],
    },
  ],
  ai: {
    enabled: true,
    assistantName: { en: "Lin Wei's AI (Sample)", zh: "林薇的 AI 助手（样板）" },
    welcome: {
      en: "This is a Product Manager sample on TalkCV! Ask about PLG activation metrics or pricing strategy.",
      zh: "你好！这是 TalkCV 的产品经理样板，可以问我关于 PLG 增长漏斗或商业化定价的案例。",
    },
    suggestedPrompts: {
      en: ["How did she lift activation by 42%?", "Explain her SaaS pricing design"],
      zh: ["她是如何把首日激活提升 42% 的？", "介绍一下她的商业化定价经验"],
    },
  },
};

export const DESIGNER_SAMPLE_PROFILE: PortfolioProfile = {
  theme: "editorial",
  siteUrl: "https://mytalkcv.com",
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
    sectionOrder: ["work", "experience", "capabilities", "contact"],
  },
  basics: {
    name: { en: "Su Ran (Sample)", zh: "苏然（独立设计师样板）" },
    initials: "SR",
    role: { en: "Brand & Product Designer · Design Systems", zh: "品牌与产品设计师 · 设计系统" },
    location: { en: "Hangzhou, China", zh: "杭州" },
    timezone: "Asia/Shanghai",
    email: "hi@mytalkcv.com",
    headline: {
      en: "Crafting calm editorial interfaces, tactile brand identities, and scalable design tokens.",
      zh: "用克制的杂志排版与可扩展设计系统，塑造一眼难忘的数字产品体验。",
    },
    intro: {
      en: "5 years designing consumer apps, editorial web experiences, and multi-brand Figma token systems. Sample showcase demonstrating how a Designer's portfolio looks on TalkCV.",
      zh: "5 年消费级应用、品牌官网与设计系统经验。此为 TalkCV 独立设计师角色演示样板（左栏档案 + 瑞士文艺衬线风）。",
    },
    education: { en: "B.F.A. in Visual Communication Design", zh: "视觉传达设计 · 艺术学学士" },
    footerNote: { en: "Sample Designer Showcase on TalkCV", zh: "TalkCV 独立设计师演示样板" },
  },
  skills: ["Figma", "Design Systems", "Editorial Typography", "Prototyping", "Framer", "Brand Identity"],
  capabilities: [
    {
      title: { en: "Multi-Brand Design Systems", zh: "多品牌设计系统与 Token" },
      summary: {
        en: "Unified 140+ components across Web & iOS, cutting design-to-dev handoff time by 50%.",
        zh: "统一 Web 与 iOS 端 140+ 组件，设计研发交付周期缩短 50%。",
      },
    },
  ],
  experiences: [
    {
      period: "2022.09 – Present",
      company: { en: "Independent Design Studio", zh: "独立数字设计工作室" },
      role: { en: "Principal Product & Brand Designer", zh: "主理人 / 资深产品设计师" },
      summary: {
        en: "Partnered with 18+ AI and consumer startups to launch brand identities and high-converting landing pages.",
        zh: "服务 18+ 家 AI 与消费科技初创团队，交付品牌识别与高转化官网。",
      },
    },
  ],
  projects: [
    {
      slug: "designer-editorial-system",
      accent: "amber",
      group: "product",
      category: { en: "Design System · Brand", zh: "设计系统 · 品牌重塑" },
      title: { en: "Editorial Design System & Flagship Web Redesign", zh: "杂志感设计系统与旗舰官网重塑" },
      role: { en: "Lead Designer", zh: "主创设计师" },
      summary: {
        en: "Rebuilt visual language with Swiss typography and semantic design tokens across 140+ components.",
        zh: "以瑞士排版网格与语义化 Token 重建 140+ 组件体系，官网转化率提升 36%。",
      },
      outcome: { en: "140+ components, +36% conversion", zh: "140+ 组件库，官网转化 +36%" },
      tags: ["Figma", "Design Tokens", "Web"],
      facts: [
        { value: "140+", label: { en: "UI Components", zh: "标准化组件" } },
        { value: "+36%", label: { en: "Site Conversion", zh: "官网转化提升" } },
        { value: "-50%", label: { en: "Handoff Time", zh: "交付耗时缩短" } },
      ],
      sections: [],
      workflow: [],
    },
  ],
  ai: {
    enabled: true,
    assistantName: { en: "Su Ran's AI (Sample)", zh: "苏然的 AI 助手（样板）" },
    welcome: {
      en: "This is an Independent Designer sample on TalkCV! Ask about her design system craft or client case studies.",
      zh: "你好！这是 TalkCV 的独立设计师样板，可以问我关于设计系统或品牌官网重塑的细节。",
    },
    suggestedPrompts: {
      en: ["How did she scale 140+ components?", "What startups has she designed for?"],
      zh: ["她是如何落地 140+ 组件设计系统的？", "服务过哪些类型的初创团队？"],
    },
  },
};
