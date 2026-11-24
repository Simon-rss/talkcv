export const CREDIT_COST = { generate: 10, edit: 3, outreach: 2 } as const;
export const PLAN_CREDITS = { free: 30, pro: 300, max: 1000 } as const;
export const REFERRAL_CREDITS = { invitee: 30, inviter: 50 } as const;

export interface CreditBalance {
  remaining: number;
  total: number;
  period: "lifetime" | "month";
  bonusRemaining: number;
}

export function creditCostLabel(cost: number, lang: "en" | "zh", byok = false) {
  if (byok) return lang === "zh" ? "自有 Key · 0 点" : "BYOK · 0 credits";
  return lang === "zh" ? `${cost} 点` : `${cost} credits`;
}

export function creationPricing(lang: "en" | "zh") {
  const { generate, edit, outreach } = CREDIT_COST;
  return lang === "zh"
    ? `使用托管模型时，生成整站简历每次 ${generate} 点，AI 精修每轮 ${edit} 点，JD 求职文案每篇 ${outreach} 点。访客 AI 对话随套餐赠送，不消耗作者点数。自有 Key 创作免扣点。`
    : `Hosted creation costs ${generate} credits per résumé site, ${edit} per refinement and ${outreach} per JD outreach draft. Visitor chats are included and use no author credits. BYOK creation uses no credits.`;
}
