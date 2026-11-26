import { CREDIT_COST } from "../lib/credits";
import { isGeminiThinkingModel, isReasoningOrNextGenOpenAI } from "../lib/models";
import {
  profileToDefaultResumePdfPlan,
  RESUME_PDF_TEMPLATES,
  sanitizeResumePdfPlan,
} from "../lib/pdf-resume-templates.mjs";
import type { PortfolioProfile } from "../lib/schema";
import { getSessionUser } from "./auth";
import { getUserPlan, type BillingEnv } from "./billing";
import type { ChatEnv } from "./chat";
import { withCreationCredits } from "./credits";
import { resolveStudioModel } from "./generate";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handlePdfResumeAiPlanRequest(request: Request, env: ChatEnv & BillingEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let body: {
    profile?: unknown;
    lang?: unknown;
    targetPages?: unknown;
    template?: unknown;
    accentColor?: unknown;
    targetRole?: unknown;
    targetJd?: unknown;
    showQr?: unknown;
    hostedModelId?: unknown;
    providerMode?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const profile = body.profile as PortfolioProfile | undefined;
  if (!profile || typeof profile !== "object" || !profile.basics) {
    return jsonResponse(400, { error: "Valid profile JSON is required." });
  }

  const byok = body.providerMode === "byok";
  const user = await getSessionUser(request, env);
  if (!byok && !user) {
    return jsonResponse(401, { error: "Sign in to use AI PDF Resume Reflow." });
  }
  const access = !byok && user ? await getUserPlan(user.email, env) : null;
  const provider = resolveStudioModel(body, byok ? "byok" : "hosted", access?.plan ?? "free", env);
  if (provider instanceof Response) return provider;
  const { baseUrl, model, apiKey } = provider;

  const lang: "zh" | "en" = body.lang === "en" ? "en" : "zh";
  const targetPages: 1 | 2 = body.targetPages === 2 ? 2 : 1;
  const requestedTemplate = typeof body.template === "string" ? body.template : "auto";
  const targetRole = typeof body.targetRole === "string" ? body.targetRole.trim().slice(0, 120) : "";
  const targetJd = typeof body.targetJd === "string" ? body.targetJd.trim().slice(0, 2400) : "";

  const fallbackPlan = profileToDefaultResumePdfPlan(profile, lang, {
    targetPages,
    template: requestedTemplate === "auto" ? undefined : requestedTemplate,
    accentColor: typeof body.accentColor === "string" ? body.accentColor : undefined,
    showQr: body.showQr !== false,
  });

  const templateList = RESUME_PDF_TEMPLATES.map((t) => `"${t.id}" (${t.desc.en})`).join(", ");
  const pageBudget =
    targetPages === 1
      ? lang === "zh"
        ? "STRICT 1-PAGE A4 BUDGET: Keep summary <= 75 Chinese chars, top 3-4 experiences (<= 2-3 tight STAR bullets each, <= 45 chars per bullet), top 2-3 strongest projects (<= 2-3 bullets each). Trim fluff so it fits cleanly on ONE A4 page."
        : "STRICT 1-PAGE A4 BUDGET: Keep summary <= 45 words, top 3-4 experiences (2-3 tight STAR bullets each), top 2-3 strongest projects (2-3 bullets each) so it fits cleanly on ONE A4 page."
      : lang === "zh"
        ? "2-PAGE A4 BUDGET: Include rich, quantified project architecture & impact bullets across experiences and up to 4-5 featured projects, balanced cleanly for TWO A4 pages."
        : "2-PAGE A4 BUDGET: Include rich, quantified project architecture & impact bullets across experiences and up to 4-5 featured projects, balanced cleanly for TWO A4 pages.";

  const systemPrompt = `You are an elite executive résumé writer and A4 typographic layout director for TalkCV.
Transform the candidate's PortfolioProfile JSON into a publication-grade A4 PDF résumé plan JSON (output ONLY raw JSON, no markdown fences).

Output schema:
{
  "template": one of ${templateList},
  "accentColor": 6-digit hex color suited to the profession (dark, print-safe, high contrast on white paper, e.g. #1d4ed8, #0f766e, #111827, #4338ca, #b45309),
  "targetPages": ${targetPages},
  "density": "${targetPages === 1 ? "compact" : "balanced"}" (or "spacious"),
  "sectionOrder": permutation of ["summary","skills","experience","projects","education"] ordered to lead with this candidate's strongest proof,
  "name": string,
  "role": string,
  "headline": string (1 punchy positioning line),
  "summary": string,
  "contacts": string[],
  "skills": string[] (prioritized by relevance),
  "experiences": [{ "company": string, "role": string, "period": string, "bullets": string[] }],
  "projects": [{ "title": string, "role": string, "period": string, "summary": string, "metrics": string[], "bullets": string[] }],
  "education": string,
  "aiNote": "1 concise sentence in ${lang === "zh" ? "Simplified Chinese (简体中文)" : "English"} explaining how you reorganized & sharpened this résumé"
}

Rules:
- OUTPUT LANGUAGE: Write ALL résumé text fields and aiNote strictly in ${lang === "zh" ? "Simplified Chinese (简体中文)" : "English"}.
- ${pageBudget}
- ${requestedTemplate !== "auto" ? `KEEP template as "${requestedTemplate}".` : "Choose the best-fitting template for this candidate's profession."}
- ${targetRole || targetJd ? `TAILOR FOR TARGET ROLE/JD: Reorder projects, skills, and sectionOrder to highlight genuine alignment with the target role/JD below.` : "Highlight the candidate's highest-impact achievements first."}
- STRICT FACTUAL FIDELITY: NEVER invent companies, dates, degrees, skills, or numbers not present in the source profile. Preserve every real number/metric verbatim. Rewrite weak prose into crisp Action + Scope + Metric STAR bullets.`;

  const compactSource = {
    basics: { ...profile.basics, avatar: undefined },
    skills: profile.skills,
    experiences: profile.experiences,
    projects: profile.projects.map((p) => ({ ...p, coverImage: undefined })),
  };

  return withCreationCredits(user?.email, byok ? 0 : CREDIT_COST.edit, env, request, async (signal) => {
    const callAi = (targetModel: string) =>
      fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: targetModel,
          ...(isReasoningOrNextGenOpenAI(targetModel)
            ? {}
            : isGeminiThinkingModel(targetModel)
              ? { reasoning_effort: "low" }
              : { temperature: 0.25 }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Source profile JSON:\n${JSON.stringify(compactSource).slice(0, 20000)}${
                targetRole ? `\n\nTarget role: ${targetRole}` : ""
              }${targetJd ? `\n\nTarget JD:\n${targetJd}` : ""}`,
            },
          ],
        }),
      });

    let upstream = await callAi(model);
    if ([400, 404].includes(upstream.status) && baseUrl === "https://api.deepseek.com/v1" && model !== "deepseek-chat") {
      upstream = await callAi("deepseek-chat");
    }
    if (upstream.status !== 200) {
      return jsonResponse(upstream.status === 401 ? 401 : 502, { error: `AI provider returned HTTP ${upstream.status}.` });
    }
    const payload = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const plan = sanitizeResumePdfPlan(
      {
        ...parsed,
        lang,
        targetPages,
        showQr: body.showQr !== false,
        ...(requestedTemplate !== "auto" ? { template: requestedTemplate } : {}),
      },
      fallbackPlan,
    );
    if (!plan.aiNote) {
      plan.aiNote =
        lang === "zh"
          ? `已按 ${targetPages} 页 A4 预算完成 STAR 精炼与版式重排。`
          : `Reorganized and refined into a crisp ${targetPages}-page A4 résumé.`;
    }
    return { ok: true, plan };
  });
}
