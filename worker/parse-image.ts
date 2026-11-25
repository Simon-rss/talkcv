import { getSessionUser } from "./auth";
import type { ChatEnv } from "./chat";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const ocrRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkOcrRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ocrRateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    ocrRateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 12) return false;
  bucket.count += 1;
  return true;
}

export async function handleParseResumeImageRequest(request: Request, env: ChatEnv): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const user = await getSessionUser(request, env);
  if (!user) {
    return jsonResponse(401, { error: "Please sign in with your email to extract text from résumé images." });
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  if (!checkOcrRateLimit(ip)) {
    return jsonResponse(429, { error: "Too many image uploads. Please wait a minute and try again." });
  }

  let body: { imageDataUrl?: unknown; fileName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
  if (
    !imageDataUrl ||
    imageDataUrl.length > 3_200_000 ||
    !/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)
  ) {
    return jsonResponse(400, { error: "Please upload a valid PNG, JPG, or WebP résumé image." });
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return jsonResponse(503, { error: "Image OCR service is not configured on this server." });
  }
  const baseUrl = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a verbatim résumé OCR extractor. Transcribe ALL visible text from the résumé image cleanly into structured plain text (preserve section headings, dates, numbers, GPA, emails, links, and bullet points verbatim). Mark mosaic/redacted areas as [已打码] if Chinese or [REDACTED] if English. Never invent information not present in the image. Output plain text only, no markdown code fences.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all text from this résumé image verbatim:" },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });
  } catch {
    return jsonResponse(502, { error: "Unable to reach image OCR service." });
  }

  if (!upstream.ok) {
    return jsonResponse(502, { error: `Image OCR provider returned HTTP ${upstream.status}.` });
  }

  const payload = (await upstream.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const text = (payload?.choices?.[0]?.message?.content ?? "").trim();
  if (text.length < 15) {
    return jsonResponse(422, { error: "Could not read enough résumé text from this image. Please upload a clearer image." });
  }

  return jsonResponse(200, {
    ok: true,
    text,
    chars: text.length,
    fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 120) : "resume-image",
  });
}
