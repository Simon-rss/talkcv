export interface HostedModelOption {
  id: string;
  provider: "auto" | "deepseek" | "openai";
  label: { en: string; zh: string };
  tier: "free" | "pro";
  apiModel?: string;
}

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
    id: "deepseek-v4.1-flash",
    provider: "deepseek",
    label: { en: "DeepSeek V4.1 Flash", zh: "DeepSeek V4.1 Flash（极速）" },
    tier: "free",
    apiModel: "deepseek-v4.1-flash",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    label: { en: "OpenAI GPT-4o mini", zh: "OpenAI GPT-4o mini" },
    tier: "free",
    apiModel: "gpt-4o-mini",
  },
  // Pro tier models (locked until Pro plan; users with BYOK can use any model freely)
  {
    id: "gpt-6.2-sol",
    provider: "openai",
    label: { en: "OpenAI GPT-6.2 Sol", zh: "OpenAI GPT-6.2 Sol" },
    tier: "pro",
    apiModel: "gpt-6.2-sol",
  },
  {
    id: "gpt-6.1",
    provider: "openai",
    label: { en: "OpenAI GPT-6.1", zh: "OpenAI GPT-6.1" },
    tier: "pro",
    apiModel: "gpt-6.1",
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    label: { en: "OpenAI GPT-5.4", zh: "OpenAI GPT-5.4" },
    tier: "pro",
    apiModel: "gpt-5.4",
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
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: { en: "DeepSeek Reasoner (R1)", zh: "DeepSeek Reasoner（深度推理）" },
    tier: "pro",
    apiModel: "deepseek-reasoner",
  },
];

export const FREE_MODEL_IDS = new Set(
  HOSTED_MODELS.filter((m) => m.tier === "free").map((m) => m.id),
);

export function getHostedModel(id: string | undefined): HostedModelOption {
  return HOSTED_MODELS.find((m) => m.id === id) ?? HOSTED_MODELS[0];
}
