import { canUseModel, getHostedModel } from "../lib/models";
import { isValidTheme, sanitizeDesignTokens, type PortfolioProfile, type ThemeId } from "../lib/schema";
import { getSessionUser } from "./auth";
import { getDailyEditUsage, getUserPlan, incrementDailyEditUsage, type BillingEnv } from "./billing";
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

  const byokKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const isByok = body.providerMode === "byok" && Boolean(byokKey);

  let apiKey = "";
  let baseUrl = "https://api.openai.com/v1";
  let model = "gpt-4o-mini";
  let userEmail: string | null = null;
  let editDailyLimit = 0;

  if (isByok) {
    apiKey = byokKey;
    baseUrl = ((typeof body.baseUrl === "string" && body.baseUrl.trim()) || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    model = (typeof body.model === "string" && body.model.trim()) || "gpt-4o-mini";
  } else {
    const user = await getSessionUser(request, env);
    if (!user) {
      return jsonResponse(401, {
        error: "Please sign in and upgrade to TalkCV Pro or Max to use AI Live Refine.",
      });
    }
    const { plan, limits } = await getUserPlan(user.email, env);
    if (!limits.aiLiveEdit) {
      return jsonResponse(403, {
        error: "AI Live Refine is a TalkCV Pro / Max feature. Upgrade your plan to unlock multi-turn AI editing.",
      });
    }
    editDailyLimit = limits.dailyEditLimit;
    const used = await getDailyEditUsage(user.email, env);
    if (used >= editDailyLimit) {
      return jsonResponse(429, {
        error: `Daily AI refine limit reached (${editDailyLimit}/day). Try again tomorrow or upgrade to Max.`,
      });
    }
    userEmail = user.email;

    const requestedId =
      typeof body.hostedModelId === "string" && body.hostedModelId.trim()
        ? body.hostedModelId.trim()
        : "deepseek-chat";
    if (!canUseModel(requestedId, plan)) {
      return jsonResponse(403, {
        error: `Model "${requestedId}" requires a higher TalkCV plan.`,
      });
    }
    const chosen = getHostedModel(requestedId === "auto" ? "deepseek-chat" : requestedId);
    if (chosen.provider === "deepseek") {
      apiKey = env.DEEPSEEK_API_KEY?.trim() || "";
      baseUrl = "https://api.deepseek.com/v1";
      model = chosen.apiModel || "deepseek-chat";
    } else {
      apiKey = env.OPENAI_API_KEY?.trim() || "";
      baseUrl = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
      model = chosen.apiModel || env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
    }
    if (!apiKey) {
      return jsonResponse(503, { error: `Hosted ${chosen.provider} is not configured on this server.` });
    }
  }

  const theme: ThemeId = isValidTheme(body.theme) ? body.theme : currentProfile.theme || "editorial";
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
- NEVER invent fake companies, URLs, or metrics that the user didn't ask for.
- Preserve existing project slugs unless explicitly asked to change them.`;

  const callEdit = (targetModel: string) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: targetModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          {
            role: "user",
            content: `Current profile JSON (theme: ${theme}):\n${JSON.stringify(currentProfile).slice(0, 24000)}\n\nEdit instruction:\n${instruction}`,
          },
        ],
      }),
    });

  let upstream: Response;
  try {
    upstream = await callEdit(model);
    if (!upstream.ok && baseUrl.includes("api.deepseek.com") && model !== "deepseek-chat") {
      upstream = await callEdit("deepseek-chat");
    }
  } catch {
    return jsonResponse(502, { error: "Unable to reach AI provider." });
  }

  if (!upstream.ok) {
    return jsonResponse(upstream.status === 401 ? 401 : 502, {
      error: `AI provider returned HTTP ${upstream.status}.`,
    });
  }

  try {
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
    const mergedProfile: PortfolioProfile = {
      ...currentProfile,
      ...parsed.profile,
      theme: isValidTheme(parsed.profile.theme) ? parsed.profile.theme : theme,
      ...(updatedTokens ? { designTokens: updatedTokens } : {}),
    };

    let editQuota: { usedToday: number; dailyLimit: number } | undefined;
    if (userEmail) {
      const usedToday = await incrementDailyEditUsage(userEmail, env);
      editQuota = { usedToday, dailyLimit: editDailyLimit };
    }

    return jsonResponse(200, {
      ok: true,
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "Updated portfolio.",
      profile: mergedProfile,
      ...(editQuota ? { editQuota } : {}),
    });
  } catch {
    return jsonResponse(502, { error: "Could not parse AI edit response. Please try again." });
  }
}
