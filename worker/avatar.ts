import { getSessionUser } from "./auth";
import { getMonthlyAvatarUsage, getUserPlan, incrementMonthlyAvatarUsage, type BillingEnv } from "./billing";
import type { ChatEnv } from "./chat";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleGenerateAvatarRequest(
  request: Request,
  env: ChatEnv & BillingEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const user = await getSessionUser(request, env);
  if (!user) {
    return jsonResponse(401, { error: "Please sign in and upgrade to Pro or Max to generate AI avatars." });
  }

  const { limits } = await getUserPlan(user.email, env);
  if (limits.avatarGenLimit <= 0) {
    return jsonResponse(403, {
      error: "AI Avatar generation is a TalkCV Pro / Max feature. Upgrade your plan to unlock it.",
    });
  }

  const used = await getMonthlyAvatarUsage(user.email, env);
  if (used >= limits.avatarGenLimit) {
    return jsonResponse(429, {
      error: `Monthly AI avatar limit reached (${limits.avatarGenLimit}/month).`,
    });
  }

  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    return jsonResponse(503, { error: "OpenAI image service is not configured on this server." });
  }

  let body: { name?: unknown; role?: unknown; stylePrompt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "Software Engineer";
  const role = typeof body.role === "string" ? body.role.trim().slice(0, 80) : "Tech Professional";
  const style = typeof body.stylePrompt === "string" ? body.stylePrompt.trim().slice(0, 160) : "";

  const prompt = `Minimalist modern flat editorial portrait avatar icon for a ${role} named ${name}. Clean geometric vector illustration style, friendly professional aesthetic, soft studio gradient background, centered composition, no text, no watermark${style ? `. Style hint: ${style}` : ""}.`;
  const baseUrl = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");

  const tryGenerate = (model: string, extra: Record<string, unknown>) =>
    fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${openaiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, prompt, n: 1, ...extra }),
    });

  let upstream: Response | null = null;
  try {
    upstream = await tryGenerate("gpt-image-1", { size: "1024x1024", quality: "low" });
    if (!upstream.ok) {
      upstream = await tryGenerate("dall-e-3", { size: "1024x1024", response_format: "b64_json" });
    }
  } catch {
    return jsonResponse(502, { error: "Unable to reach AI image provider." });
  }

  if (!upstream || !upstream.ok) {
    return jsonResponse(502, { error: "AI avatar generation failed. Please try again later." });
  }

  try {
    const data = (await upstream.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = data.data?.[0];
    let avatarUrl = "";
    if (item?.b64_json) {
      avatarUrl = `data:image/png;base64,${item.b64_json}`;
    } else if (item?.url) {
      avatarUrl = item.url;
    }
    if (!avatarUrl) {
      return jsonResponse(502, { error: "AI image provider returned an empty image." });
    }

    const usedAfter = await incrementMonthlyAvatarUsage(user.email, env);
    return jsonResponse(200, {
      ok: true,
      avatar: avatarUrl,
      avatarQuota: { usedThisMonth: usedAfter, limit: limits.avatarGenLimit },
    });
  } catch {
    return jsonResponse(502, { error: "Could not parse AI avatar response." });
  }
}
