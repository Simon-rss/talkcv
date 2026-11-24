import { CREDIT_COST } from "../lib/credits";
import { isReasoningOrNextGenOpenAI } from "../lib/models";
import { resolveStudioModel } from "./generate";
import { withCreationCredits } from "./credits";
import { isValidTheme, sanitizeDesignTokens, sanitizeLayoutPlan, type PortfolioProfile, type ThemeId } from "../lib/schema";
import { getSessionUser } from "./auth";
import { getUserPlan, type BillingEnv } from "./billing";
import type { ChatEnv } from "./chat";

interface EditHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleAiEditRequest(request: Request, env: ChatEnv & BillingEnv): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let body: {
    profile?: unknown;
    instruction?: unknown;
    history?: unknown;
    theme?: unknown;
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

  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 1200) : "";
  if (instruction.length < 2) {
    return jsonResponse(400, { error: "Please enter an edit instruction." });
  }

  const currentProfile = body.profile as PortfolioProfile | undefined;
  if (!currentProfile || typeof currentProfile !== "object" || !currentProfile.basics) {
    return jsonResponse(400, { error: "Valid current profile JSON is required." });
  }

  const byok = body.providerMode === "byok";
  const user = await getSessionUser(request, env);
  if (!byok && !user) return jsonResponse(401, { error: "Sign in to use AI Live Refine." });
  const access = !byok && user ? await getUserPlan(user.email, env) : null;
  if (access && !access.limits.aiLiveEdit) return jsonResponse(403, { error: "AI Live Refine requires Pro, a Pro trial or Max." });
  const provider = resolveStudioModel(body, byok ? "byok" : "hosted", access?.plan ?? "free", env);
  if (provider instanceof Response) return provider;
  const { baseUrl, model, apiKey } = provider;

  const theme: ThemeId = isValidTheme(body.theme) ? body.theme : currentProfile.theme || "editorial";
  const textProfile = { ...currentProfile, basics: { ...currentProfile.basics } };
  delete textProfile.basics.avatar;
  const history: EditHistoryTurn[] = Array.isArray(body.history)
    ? body.history
        .slice(-6)
        .filter(
          (item): item is EditHistoryTurn =>
            Boolean(item) &&
            typeof item === "object" &&
            ((item as EditHistoryTurn).role === "user" || (item as EditHistoryTurn).role === "assistant") &&
            typeof (item as EditHistoryTurn).content === "string",
        )
        .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 600) }))
    : [];

  const systemPrompt = `You are TalkCV's interactive portfolio AI editor.
Given the current TalkCV profile JSON and the owner's edit instruction, apply ONLY the requested changes cleanly while preserving all unaffected fields, structure, and verified facts/metrics.
Output ONLY a raw JSON object with this exact shape (no markdown fences):
{
  "summary": "Brief 1-sentence summary of what you changed (in the same language as the user's instruction)",
  "profile": { ...the complete updated PortfolioProfile JSON... }
}
Rules:
- Keep both "en" and "zh" synced whenever you edit bilingual text fields.
- If the user asks to change colors or border radius, update "profile.designTokens" with safe 6-digit hex colors (#RRGGBB) and radius (0px-28px).
- If the user asks to change layout, section order, hero style, project layout, or typography, update "profile.layoutPlan" (heroStyle: "editorial-split"|"centered-minimal"|"sidebar-dossier"|"terminal-hero"; projectLayout: "bento-grid"|"editorial-rows"|"timeline-cases"|"card-grid"; fontPair: "sans-modern"|"serif-editorial"|"mono-tech"; sectionOrder: permutation of ["work","capabilities","experience","contact"]).
- NEVER invent fake companies, URLs, or metrics that the user didn't ask for.
- Preserve existing project slugs unless explicitly asked to change them.`;

  return withCreationCredits(user?.email, byok ? 0 : CREDIT_COST.edit, env, request, async (signal) => {
    const callEdit = (targetModel: string) =>
      fetch(`${baseUrl}/chat/completions`, {
        method: "POST", signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: targetModel,
          ...(isReasoningOrNextGenOpenAI(targetModel) ? {} : { temperature: 0.2 }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
            {
              role: "user",
              content: `Current profile JSON (theme: ${theme}):\n${JSON.stringify(textProfile).slice(0, 24000)}\n\nEdit instruction:\n${instruction}`,
            },
          ],
        }),
      });
    let upstream = await callEdit(model);
    if ([400, 404].includes(upstream.status) && baseUrl === "https://api.deepseek.com/v1" && model !== "deepseek-chat") {
      upstream = await callEdit("deepseek-chat");
    }
    if (upstream.status !== 200) return jsonResponse(upstream.status === 401 ? 401 : 502, { error: `AI provider returned HTTP ${upstream.status}.` });
    const payload = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as { summary?: string; profile?: PortfolioProfile };
    if (!parsed.profile || typeof parsed.profile !== "object" || !parsed.profile.basics) {
      throw new Error("Missing profile");
    }

    const updatedTokens = sanitizeDesignTokens(parsed.profile.designTokens);
    const updatedLayout = sanitizeLayoutPlan(parsed.profile.layoutPlan);
    const mergedProfile: PortfolioProfile = {
      ...currentProfile,
      ...parsed.profile,
      basics: { ...parsed.profile.basics, avatar: currentProfile.basics.avatar },
      theme: isValidTheme(parsed.profile.theme) ? parsed.profile.theme : theme,
      ...(updatedTokens ? { designTokens: updatedTokens } : {}),
      ...(updatedLayout ? { layoutPlan: updatedLayout } : {}),
    };
    return { ok: true, summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "Updated portfolio.", profile: mergedProfile };
  });
}
