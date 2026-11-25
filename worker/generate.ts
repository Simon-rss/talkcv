import { normalizeContacts } from "../lib/contacts.mjs";
import { canUseModel, getHostedModel, isGeminiThinkingModel, isReasoningOrNextGenOpenAI, type PlanTier } from "../lib/models";
import { profile as sampleProfile } from "../lib/profile";
import {
  isValidTheme,
  sanitizeDesignTokens,
  sanitizeLayoutPlan,
  type PortfolioProfile,
  type ProjectAccent,
  type ThemeId,
} from "../lib/schema";
import { CREDIT_COST } from "../lib/credits";
import { BoundedRateLimiter } from "../lib/rate-limit";
import { getClientIp } from "../lib/request-ip";
import { getSessionUser } from "./auth";
import { getUserPlan } from "./billing";
import { withCreationCredits } from "./credits";
import type { ChatEnv } from "./chat";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const genLimiter = new BoundedRateLimiter({ windowMs: RATE_WINDOW_MS, maxRequests: RATE_LIMIT, maxEntries: 5000 });
const DEFAULT_GUEST_TRIAL_DAILY_CAP = 150;

const VALID_ACCENTS: ProjectAccent[] = ["mint", "blue", "coral", "amber"];
const VALID_GROUPS = ["platform", "enterprise", "product"] as const;

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function checkRateLimit(ip: string): boolean {
  return genLimiter.check(ip);
}

function loc(value: unknown, fallback = ""): { en: string; zh: string } {
  if (!value) return { en: fallback, zh: fallback };
  if (typeof value === "string") return { en: value, zh: value };
  const obj = value as { en?: unknown; zh?: unknown };
  const en = typeof obj.en === "string" && obj.en.trim() ? obj.en.trim() : "";
  const zh = typeof obj.zh === "string" && obj.zh.trim() ? obj.zh.trim() : "";
  return { en: en || zh || fallback, zh: zh || en || fallback };
}

function slugify(value: string, fallback: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function normalizeGeneratedProfile(
  raw: Record<string, unknown>,
  theme: ThemeId,
  siteUrl: string,
  stylePrompt?: string,
  sourceResumeText = "",
): PortfolioProfile {
  const basicsRaw = (raw.basics && typeof raw.basics === "object" ? raw.basics : {}) as Record<string, unknown>;
  const name = loc(basicsRaw.name, "Portfolio Owner");
  const initials =
    (typeof basicsRaw.initials === "string" && basicsRaw.initials.trim().slice(0, 2).toUpperCase()) ||
    name.en
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ||
    "TC";

  const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
  const projects = rawProjects.slice(0, 6).map((item, idx) => {
    const p = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const title = loc(p.title, `Project ${idx + 1}`);
    const accent = VALID_ACCENTS.includes(p.accent as ProjectAccent)
      ? (p.accent as ProjectAccent)
      : VALID_ACCENTS[idx % VALID_ACCENTS.length];
    const group = VALID_GROUPS.includes(p.group as (typeof VALID_GROUPS)[number])
      ? (p.group as (typeof VALID_GROUPS)[number])
      : VALID_GROUPS[idx % VALID_GROUPS.length];

    const rawFacts = Array.isArray(p.facts) ? p.facts : [];
    const facts = rawFacts.slice(0, 4).map((f) => {
      const fObj = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return { value: String(fObj.value ?? ""), label: loc(fObj.label, "") };
    });

    const rawSections = Array.isArray(p.sections) ? p.sections : [];
    const sections =
      rawSections.length > 0
        ? rawSections.slice(0, 4).map((s) => {
            const sObj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
            const items = Array.isArray(sObj.items)
              ? sObj.items.slice(0, 5).map((it) => loc(it, ""))
              : undefined;
            return {
              eyebrow: loc(sObj.eyebrow, "DETAILS"),
              title: loc(sObj.title, "Architecture & Delivery"),
              body: loc(sObj.body, ""),
              ...(items && items.length > 0 ? { items } : {}),
            };
          })
        : [
            {
              eyebrow: { en: "OVERVIEW", zh: "项目概述" },
              title,
              body: loc(p.summary, ""),
            },
          ];

    const rawWorkflow = Array.isArray(p.workflow) ? p.workflow : [];
    const workflow = rawWorkflow.slice(0, 4).map((w, wIdx) => {
      const wObj = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
      return {
        number: String(wObj.number ?? `0${wIdx + 1}`),
        title: loc(wObj.title, `Step ${wIdx + 1}`),
        text: loc(wObj.text, ""),
      };
    });

    return {
      slug: slugify(typeof p.slug === "string" ? p.slug : title.en, `project-${idx + 1}`),
      accent,
      group,
      category: loc(p.category, "FEATURED PROJECT"),
      title,
      role: loc(p.role, "Engineer"),
      summary: loc(p.summary, ""),
      outcome: loc(p.outcome ?? p.summary, ""),
      tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 6) : [],
      facts,
      sections,
      workflow,
    };
  });

  const rawExperiences = Array.isArray(raw.experiences) ? raw.experiences : [];
  const experiences = rawExperiences.slice(0, 8).map((item) => {
    const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      period: String(e.period ?? ""),
      company: loc(e.company, ""),
      role: loc(e.role, ""),
      summary: loc(e.summary, ""),
    };
  });

  const rawCaps = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  const capabilities = rawCaps.slice(0, 4).map((item) => {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return { title: loc(c.title, "Core Capability"), summary: loc(c.summary, "") };
  });

  const cleanStylePrompt = stylePrompt?.trim().slice(0, 400) || undefined;
  const designTokens = sanitizeDesignTokens(raw.designTokens);
  const layoutPlan = sanitizeLayoutPlan(raw.layoutPlan);

  return {
    theme,
    siteUrl: siteUrl.replace(/\/+$/, ""),
    ...(cleanStylePrompt ? { stylePrompt: cleanStylePrompt } : {}),
    ...(designTokens ? { designTokens } : {}),
    ...(layoutPlan ? { layoutPlan } : {}),
    basics: {
      name,
      initials,
      role: loc(basicsRaw.role, "Software Engineer"),
      location: loc(basicsRaw.location, "Remote"),
      timezone: typeof basicsRaw.timezone === "string" && basicsRaw.timezone.trim() ? basicsRaw.timezone.trim() : "UTC",
      ...normalizeContacts(basicsRaw, sourceResumeText),
      headline: loc(basicsRaw.headline, "Building reliable software systems."),
      intro: loc(basicsRaw.intro, ""),
      education: loc(basicsRaw.education, ""),
      footerNote: {
        en: "Powered by TalkCV · Edit data/profile.json or run npm run generate",
        zh: "由 TalkCV 驱动 · 编辑 data/profile.json 或运行 npm run generate",
      },
    },
    skills: Array.isArray(raw.skills) ? raw.skills.map(String).slice(0, 18) : [],
    capabilities,
    experiences,
    projects,
    ai: {
      enabled: true,
      ...(cleanStylePrompt ? { stylePrompt: cleanStylePrompt } : {}),
      assistantName: {
        en: `${name.en.split(" ")[0]}'s AI Agent`,
        zh: `${name.zh} 的 AI 助手`,
      },
      welcome: {
        en: `Hi! Ask me about ${name.en}'s projects, technical depth, or paste a Job Description for an honest match report.`,
        zh: `你好！可以问我关于 ${name.zh} 的项目架构与实战经历，也可以直接贴一段 JD 测匹配度。`,
      },
      suggestedPrompts: {
        en: [
          "Walk me through the strongest project",
          "Summarize core engineering strengths",
          "Draft an interview invite email",
        ],
        zh: [
          "介绍一下最硬核的代表项目",
          "总结一下核心技术与架构优势",
          "帮我起草一封面试邀约邮件",
        ],
      },
    },
  };
}

interface ModelSettings {
  hostedModelId?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
}

export function resolveStudioModel(body: ModelSettings, mode: string, plan: PlanTier, env: ChatEnv) {
  if (mode === "byok") {
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) return jsonResponse(401, { error: "An OpenAI-compatible API key is required for BYOK mode." });
    return {
      apiKey,
      baseUrl: ((typeof body.baseUrl === "string" && body.baseUrl.trim()) || "https://api.openai.com/v1").replace(/\/+$/, ""),
      model: (typeof body.model === "string" && body.model.trim()) || "gpt-4o-mini",
    };
  }
  const requested = (typeof body.hostedModelId === "string" && body.hostedModelId.trim()) ||
    (mode === "hosted-openai" ? "gpt-4o-mini" : "deepseek-chat");
  if (!canUseModel(requested, plan)) {
    return jsonResponse(403, { error: `Model "${requested}" requires TalkCV Pro or Max (or use BYOK with your own API key).` });
  }
  const chosen = getHostedModel(requested === "auto" ? "deepseek-chat" : requested);
  if (chosen.provider === "gemini") {
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) return jsonResponse(503, { error: "Hosted gemini is not configured on this server." });
    return {
      apiKey,
      model: chosen.apiModel || "gemini-3.5-flash-lite",
      baseUrl: (env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, ""),
    };
  }
  const deepseek = chosen.provider === "deepseek";
  const apiKey = (deepseek ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY)?.trim();
  if (!apiKey) return jsonResponse(503, { error: `Hosted ${chosen.provider} is not configured on this server.` });
  return { apiKey, model: chosen.apiModel || (deepseek ? "deepseek-chat" : env.OPENAI_MODEL?.trim() || "gpt-4o-mini"),
    baseUrl: deepseek ? "https://api.deepseek.com/v1" : (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "") };
}

const memGuestTrials = new Set<string>();
const memGuestGlobalCount = new Map<string, number>();

export async function handleGenerateRequest(request: Request, env: ChatEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const ip = getClientIp(request, env);

  if (!checkRateLimit(ip)) {
    return jsonResponse(429, { error: "Rate limit exceeded. Please wait a minute and try again." });
  }

  let body: {
    resumeText?: unknown;
    theme?: unknown;
    siteUrl?: unknown;
    stylePrompt?: unknown;
    hostedModelId?: unknown;
    providerMode?: unknown;
    guestTrial?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const resumeText = typeof body.resumeText === "string" ? body.resumeText.trim() : "";
  if (resumeText.length < 30) {
    return jsonResponse(400, { error: "Please provide at least 30 characters of resume text." });
  }

  const stylePrompt = typeof body.stylePrompt === "string" ? body.stylePrompt.trim().slice(0, 400) : "";
  const byokKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const mode =
    body.providerMode === "hosted" ||
    body.providerMode === "hosted-deepseek" ||
    body.providerMode === "hosted-openai" ||
    body.providerMode === "byok"
      ? body.providerMode
      : byokKey
        ? "byok"
        : "hosted";

  const user = await getSessionUser(request, env);
  const isGuestTrial = mode !== "byok" && !user && body.guestTrial === true;
  if (mode !== "byok" && !user && !isGuestTrial) {
    return jsonResponse(401, { error: "Please sign in with your email to use hosted credits." });
  }

  let guestTrialKey = "";
  let guestGlobalKey = "";
  let guestGlobalCap = DEFAULT_GUEST_TRIAL_DAILY_CAP;
  if (isGuestTrial) {
    const today = new Date().toISOString().slice(0, 10);
    guestTrialKey = `guest_gen:${ip}:${today}`;
    guestGlobalKey = `guest_gen_global:${today}`;
    const parsedCap = Number(env.GUEST_TRIAL_DAILY_CAP);
    if (Number.isFinite(parsedCap) && parsedCap >= 0) guestGlobalCap = Math.floor(parsedCap);

    const used = env.PROFILES_KV
      ? Boolean(await env.PROFILES_KV.get(guestTrialKey))
      : memGuestTrials.has(guestTrialKey);
    const globalUsed = env.PROFILES_KV
      ? Number((await env.PROFILES_KV.get(guestGlobalKey)) ?? "0") || 0
      : (memGuestGlobalCount.get(guestGlobalKey) ?? 0);

    if (used || globalUsed >= guestGlobalCap) {
      return jsonResponse(401, {
        error: "Daily guest trial used. Please sign in with your email for 30 free lifetime credits.",
        guestTrialExhausted: true,
      });
    }
  }

  const plan = mode !== "byok" && user ? (await getUserPlan(user.email, env)).plan : "free";
  const effectiveBody = isGuestTrial
    ? {
        ...body,
        hostedModelId: env.DEEPSEEK_API_KEY?.trim() ? "deepseek-chat" : "gpt-4o-mini",
      }
    : body;
  const provider = resolveStudioModel(effectiveBody, mode, plan, env);
  if (provider instanceof Response) return provider;
  const { apiKey, baseUrl, model } = provider;

  const theme: ThemeId = isValidTheme(body.theme) ? body.theme : "editorial";
  const siteUrl =
    typeof body.siteUrl === "string" && body.siteUrl.trim().startsWith("http")
      ? body.siteUrl.trim()
      : "https://mytalkcv.com";

  const styleInstruction = stylePrompt
    ? `\n- Custom style & tone preference from the user: "${stylePrompt}". Reflect this tone in headline, intro, project framing, AND optionally include a "designTokens" object with safe hex colors & radius matching the theme (${theme}), e.g. {"accent":"#0f766e","radius":"14px"} (only 6-digit hex colors #RRGGBB and radius 0px-28px; ensure high readability contrast with the ${theme} theme).`
    : "";

  const sanitizedSample = {
    ...sampleProfile,
    basics: { ...sampleProfile.basics, ...normalizeContacts({}) },
    projects: sampleProfile.projects.map((p) => ({ ...p, links: undefined })),
  };

  const systemPrompt = `You are a precise resume-to-portfolio compiler for TalkCV. Convert the resume into a valid JSON object matching this exact schema (output ONLY raw JSON, no markdown fences).
Rules:
- Populate BOTH "en" and "zh" for every localized field (translate faithfully if the resume is single-language).
- Extract up to 5 featured projects actually described in the résumé. If it lists none, return projects: []. Use only its own metrics, architecture details and workflow steps.
- STRICT VERBATIM NUMERICAL FIDELITY: NEVER alter, round, recalculate, or invent any number, duration, percentage, or metric from the resume (e.g. if the resume says "27 -> 8 minutes", facts[] and summary MUST say "27 -> 8", NEVER change 27 to another number).
- NEVER invent companies, skills, or URLs not present in the resume. Copy only explicitly supplied contact details into basics.email, github, wechat (ID), linkedin and portfolio (blog or personal URL). Use absolute HTTP(S) links and omit missing contacts.
- PERSONALIZED LAYOUT & VISUAL IDENTITY: Every candidate should feel bespoke, NOT cookie-cutter. Include a "layoutPlan" object tailored to this person's profession, seniority, and tone:
  - "heroStyle": pick one of "editorial-split" (executive/product/ops), "centered-minimal" (designer/creative/founder), "sidebar-dossier" (student/academic/admin/consulting/legal), or "terminal-hero" (backend/systems/AI engineer).
  - "projectLayout": pick one of "bento-grid" (varied-size cards with featured hero project), "editorial-rows" (wide magazine rows for research/case studies), "timeline-cases" (chronological case flow), or "card-grid" (clean balanced cards).
  - "fontPair": pick one of "serif-editorial" (humanities/editorial/luxury/legal/admin), "sans-modern" (product/tech/business), or "mono-tech" (engineering/systems/security).
  - "sectionOrder": order ["work","capabilities","experience","contact"] to lead with this candidate's strongest proof (e.g., students/career-switchers/ops can lead with "experience" or "capabilities" before "work"; engineers/designers lead with "work").
- Also tailor "designTokens" with a harmonious visual skin suited to their domain & custom style prompt:
  - "accent" (primary 6-digit hex), "accent2" (secondary 6-digit hex), optional "bg", "surface", "ink", "muted" (all 6-digit hex with strong WCAG contrast!), "radius" (0px-24px),
  - "bgPattern": one of "none" | "grid" | "dots" | "glow",
  - "cardStyle": one of "elevated" | "glass" | "brutalist" | "minimal" | "neon",
  - "buttonStyle": one of "pill" | "sharp" | "solid".
- Use lowercase ASCII kebab-case slugs.${styleInstruction}

Reference schema example:
${JSON.stringify(sanitizedSample)}`;

  return withCreationCredits(user?.email, mode === "byok" || isGuestTrial ? 0 : CREDIT_COST.generate, env, request, async (signal) => {
    const callGenerate = (targetModel: string) => fetch(`${baseUrl}/chat/completions`, {
      method: "POST", signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: targetModel,
        ...(isReasoningOrNextGenOpenAI(targetModel)
          ? {}
          : isGeminiThinkingModel(targetModel)
            ? { reasoning_effort: "low" }
            : { temperature: 0.1 }),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemPrompt },
          { role: "user", content: `Convert this resume into TalkCV profile.json:\n\n${resumeText.slice(0, 14000)}` }],
      }),
    });
    let upstream = await callGenerate(model);
    if ([400, 404].includes(upstream.status) && baseUrl === "https://api.deepseek.com/v1" && model !== "deepseek-chat") {
      upstream = await callGenerate("deepseek-chat");
    }
    if (upstream.status !== 200) return jsonResponse(upstream.status === 401 ? 401 : 502, {
      error: upstream.status === 401 ? "Invalid API key." : `AI provider returned HTTP ${upstream.status}.`,
    });
    const payload = await upstream.json();
    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!parsed?.basics?.name) return jsonResponse(502, { error: "Model response is missing a résumé." });
    if (isGuestTrial && guestTrialKey) {
      if (env.PROFILES_KV) {
        await env.PROFILES_KV.put(guestTrialKey, "1");
        const curGlobal = Number((await env.PROFILES_KV.get(guestGlobalKey)) ?? "0") || 0;
        await env.PROFILES_KV.put(guestGlobalKey, String(curGlobal + 1));
      } else {
        memGuestTrials.add(guestTrialKey);
        memGuestGlobalCount.set(guestGlobalKey, (memGuestGlobalCount.get(guestGlobalKey) ?? 0) + 1);
      }
    }
    return {
      profile: normalizeGeneratedProfile(parsed, theme, siteUrl, stylePrompt, resumeText),
      ...(isGuestTrial ? { guestTrialUsed: true } : {}),
    };
  });
}
