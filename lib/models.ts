export type PlanTier = "free" | "pro" | "max";

export interface HostedModelOption {
  id: string;
  provider: "auto" | "deepseek" | "openai" | "gemini";
  label: { en: string; zh: string };
  tier: PlanTier;
  apiModel?: string;
}

export const OPENAI_PROMO_ACTIVE = true;

export const HOSTED_MODELS: ReadonlyArray<HostedModelOption> = [
  {
    id: "auto",
    provider: "auto",
    label: { en: "Auto Smart Route (CN→DeepSeek / Global→OpenAI)", zh: "智能路由（国内 DeepSeek / 海外 OpenAI）" },
    tier: "free",
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    label: { en: "DeepSeek Chat", zh: "DeepSeek Chat（国内直连）" },
    tier: "free",
    apiModel: "deepseek-chat",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    label: { en: "OpenAI GPT-4o mini", zh: "OpenAI GPT-4o mini" },
    tier: "free",
    apiModel: "gpt-4o-mini",
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    label: { en: "Google Gemini 3.5 Flash-Lite (Fast)", zh: "Google Gemini 3.5 Flash-Lite（极速）" },
    tier: "free",
    apiModel: "gemini-3.5-flash-lite",
  },
  // Pro tier models
  {
    id: "gemini-3.8-flash",
    provider: "gemini",
    label: { en: "Google Gemini 3.8 Flash", zh: "Google Gemini 3.8 Flash（均衡主力）" },
    tier: "pro",
    apiModel: "gemini-3.8-flash",
  },
  {
    id: "gemini-4-hydrogen",
    provider: "gemini",
    label: { en: "Google Gemini 4 Hydrogen", zh: "Google Gemini 4 Hydrogen（新一代高速）" },
    tier: "pro",
    apiModel: "gemini-4-hydrogen",
  },
  {
    id: "deepseek-v4.1-flash",
    provider: "deepseek",
    label: { en: "DeepSeek V4.1 Flash", zh: "DeepSeek V4.1 Flash（极速）" },
    tier: "pro",
    apiModel: "deepseek-v4.1-flash",
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: { en: "DeepSeek Reasoner (R1)", zh: "DeepSeek Reasoner（深度推理）" },
    tier: "pro",
    apiModel: "deepseek-reasoner",
  },
  {
    id: "gpt-4o",
    provider: "openai",
    label: { en: "OpenAI GPT-4o", zh: "OpenAI GPT-4o" },
    tier: "pro",
    apiModel: "gpt-4o",
  },
  {
    id: "o3-mini",
    provider: "openai",
    label: { en: "OpenAI o3-mini", zh: "OpenAI o3-mini（推理）" },
    tier: "pro",
    apiModel: "o3-mini",
  },
  // Max tier flagship models
  {
    id: "gemini-4-carbon",
    provider: "gemini",
    label: { en: "Google Gemini 4 Carbon (Top Reasoning)", zh: "Google Gemini 4 Carbon（谷歌最强旗舰）" },
    tier: "max",
    apiModel: "gemini-4-carbon",
  },
  {
    id: "gemini-4-neon",
    provider: "gemini",
    label: { en: "Google Gemini 4 Neon (Frontier Fast)", zh: "Google Gemini 4 Neon（前沿极速旗舰）" },
    tier: "max",
    apiModel: "gemini-4-neon",
  },
  {
    id: "gemini-4-argon",
    provider: "gemini",
    label: { en: "Google Gemini 4 Argon (Efficient Reasoning)", zh: "Google Gemini 4 Argon（高效深度推理）" },
    tier: "max",
    apiModel: "gemini-4-argon",
  },
  {
    id: "gpt-6.2-astra",
    provider: "openai",
    label: { en: "OpenAI GPT-6.2 Astra (Latest Flagship)", zh: "OpenAI GPT-6.2 Astra（最新旗舰）" },
    tier: "max",
    apiModel: "gpt-6.2-astra",
  },
  {
    id: "gpt-6.2-sol",
    provider: "openai",
    label: { en: "OpenAI GPT-6.2 Sol", zh: "OpenAI GPT-6.2 Sol（旗舰）" },
    tier: "max",
    apiModel: "gpt-6.2-sol",
  },
  {
    id: "gpt-6.1",
    provider: "openai",
    label: { en: "OpenAI GPT-6.1", zh: "OpenAI GPT-6.1（旗舰）" },
    tier: "max",
    apiModel: "gpt-6.1-sol",
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    label: { en: "OpenAI GPT-5.4", zh: "OpenAI GPT-5.4（旗舰）" },
    tier: "max",
    apiModel: "gpt-5.4",
  },
];

export function isPromoUnlockedModel(model: HostedModelOption): boolean {
  return OPENAI_PROMO_ACTIVE && model.provider === "openai" && model.tier !== "free";
}

export const FREE_MODEL_IDS = new Set(
  HOSTED_MODELS.filter((m) => m.tier === "free" || isPromoUnlockedModel(m)).map((m) => m.id),
);

const TIER_RANK: Record<PlanTier, number> = { free: 0, pro: 1, max: 2 };

export function canUseModel(modelId: string, userPlan: PlanTier): boolean {
  const model = HOSTED_MODELS.find((m) => m.id === modelId);
  if (!model) return false;
  if (isPromoUnlockedModel(model)) return true;
  return TIER_RANK[userPlan] >= TIER_RANK[model.tier];
}

export function getHostedModel(id: string | undefined): HostedModelOption {
  return HOSTED_MODELS.find((m) => m.id === id) ?? HOSTED_MODELS[0];
}

export function isReasoningOrNextGenOpenAI(model: string): boolean {
  const m = model.trim().toLowerCase();
  return /^(o[1-9]|gpt-[5-9])/.test(m);
}

export function isGeminiThinkingModel(model: string): boolean {
  return /^gemini-[34]/i.test(model.trim());
}
