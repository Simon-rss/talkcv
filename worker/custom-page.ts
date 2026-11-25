import { CREDIT_COST } from "../lib/credits";
import { isReasoningOrNextGenOpenAI } from "../lib/models";
import { sanitizeCoverImage, sanitizeCustomHtml, type Lang, type PortfolioProfile } from "../lib/schema";
import { getSessionUser } from "./auth";
import { getUserPlan, type BillingEnv } from "./billing";
import type { ChatEnv } from "./chat";
import { withCreationCredits } from "./credits";
import { resolveStudioModel } from "./generate";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function hydrateCustomHtmlPlaceholders(html: string, profile: PortfolioProfile): string {
  let out = html;
  const avatar = sanitizeCoverImage(profile.basics?.avatar);
  if (avatar) {
    out = out.replace(/\{\{AVATAR_IMG\}\}/g, avatar);
  }
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  for (let i = 0; i < projects.length; i += 1) {
    const cover = sanitizeCoverImage(projects[i]?.coverImage);
    if (cover) {
      out = out.replace(new RegExp(`\\{\\{PROJECT_IMG_${i}\\}\\}`, "g"), cover);
    }
  }
  return out;
}

export async function handleGenerateCustomPageRequest(
  request: Request,
  env: ChatEnv & BillingEnv,
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body: {
    profile?: PortfolioProfile;
    stylePrompt?: unknown;
    instruction?: unknown;
    currentHtml?: unknown;
    lang?: unknown;
    providerMode?: unknown;
    hostedModelId?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const profile = body.profile;
  if (!profile || typeof profile !== "object" || !profile.basics?.name) {
    return jsonResponse(400, { error: "A generated résumé profile is required first." });
  }

  const lang: Lang = body.lang === "en" ? "en" : "zh";
  const stylePrompt = typeof body.stylePrompt === "string" ? body.stylePrompt.trim().slice(0, 600) : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 600) : "";
  const currentHtml = typeof body.currentHtml === "string" ? body.currentHtml.trim().slice(0, 120_000) : "";
  const isRefine = Boolean(currentHtml && instruction);

  if (!isRefine && !stylePrompt) {
    return jsonResponse(400, { error: "Please provide a style description or pick a preset." });
  }

  const byokKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const mode =
    body.providerMode === "byok" || (byokKey && body.providerMode !== "hosted") ? "byok" : "hosted";

  const user = await getSessionUser(request, env);
  if (mode !== "byok" && !user) {
    return jsonResponse(401, { error: "Please sign in with your email to use hosted credits." });
  }
  const plan = mode !== "byok" && user ? (await getUserPlan(user.email, env)).plan : "free";
  const provider = resolveStudioModel(body, mode, plan, env);
  if (provider instanceof Response) return provider;
  const { apiKey, baseUrl, model } = provider;

  // Build compact fact-grounded profile payload with image placeholders
  const compactProfile = {
    basics: {
      name: profile.basics.name,
      role: profile.basics.role,
      location: profile.basics.location,
      email: profile.basics.email,
      github: profile.basics.github,
      linkedin: profile.basics.linkedin,
      wechat: profile.basics.wechat,
      portfolio: profile.basics.portfolio,
      headline: profile.basics.headline,
      intro: profile.basics.intro,
      education: profile.basics.education,
      ...(sanitizeCoverImage(profile.basics.avatar) ? { avatarPlaceholder: "{{AVATAR_IMG}}" } : {}),
    },
    skills: profile.skills,
    capabilities: profile.capabilities,
    experiences: profile.experiences,
    projects: (profile.projects ?? []).map((p, idx) => ({
      title: p.title,
      category: p.category,
      role: p.role,
      summary: p.summary,
      outcome: p.outcome,
      tags: p.tags,
      facts: p.facts,
      ...(sanitizeCoverImage(p.coverImage) ? { coverImagePlaceholder: `{{PROJECT_IMG_${idx}}}` } : {}),
    })),
  };

  const systemPrompt = isRefine
    ? `You are an elite web designer and front-end craftsperson. Update the provided self-contained HTML+CSS personal portfolio page according to the user's edit instruction while keeping all factual résumé details intact.
Rules:
- Output ONLY raw HTML starting with <!DOCTYPE html> (no markdown code fences, no explanation).
- Pure HTML5 + embedded <style> CSS3 ONLY. NEVER output <script>, <iframe>, or inline on* event attributes.
- Keep it responsive on both desktop and mobile: MUST include \`@media (max-width: 640px)\` rules, \`html, body { overflow-x: hidden; }\`, \`* { box-sizing: border-box; }\`, single-column stacking on mobile, no fixed desktop pixel widths causing horizontal scroll, and \`padding-bottom: 72px\` on the page/footer so floating corner buttons never overlap links.
- Preserve any {{AVATAR_IMG}} or {{PROJECT_IMG_N}} image src placeholders that exist.`
    : `You are an elite creative director and web designer building a bespoke, unforgettable single-file HTML5 + CSS3 personal portfolio website.
Rules:
- Output ONLY raw HTML starting with <!DOCTYPE html> (no markdown code fences, no commentary).
- Language: write all visible UI copy in ${lang === "zh" ? "Simplified Chinese (简体中文)" : "English"}.
- Mandatory Mobile Responsiveness: MUST include \`* { box-sizing: border-box; }\`, \`html, body { max-width: 100%; overflow-x: hidden; }\`, responsive grids, and explicit \`@media (max-width: 640px)\` rules so nothing overflows horizontally on a 390px phone screen. Reserve at least \`72px\` bottom padding on the page/footer so floating AI buttons never cover footer content.
- Pure HTML5 + embedded <style> CSS3 ONLY. NEVER use <script>, <iframe>, external JS, or inline on* handlers. Use CSS Grid, Flexbox, gradients, custom properties, hover transitions, CSS animations, and crisp typography to deliver an extraordinary, unmistakable visual identity matching the user's requested style.
- STRICT FACTUAL FIDELITY: Use ONLY the candidate's real name, role, bio, education, skills, experiences, projects, metrics, and contacts from the JSON. NEVER invent fake employers, numbers, testimonials, or external image URLs.
- IMAGES: If a project includes "coverImagePlaceholder" (e.g. "{{PROJECT_IMG_0}}"), render <img src="{{PROJECT_IMG_0}}" alt="..." style="width:100%;aspect-ratio:16/9;object-fit:cover;" /> prominently inside that project card. If basics includes "avatarPlaceholder", render <img src="{{AVATAR_IMG}}" alt="..." /> tastefully. Do NOT invent any other <img> URLs.
- Leave ~88px bottom-right breathing room so an external floating AI chat button never overlaps key contact links.
- Ensure high contrast, clean mobile responsiveness (@media), and museum-grade visual craft.`;

  const userMessage = isRefine
    ? `Edit instruction:\n${instruction}\n\nCandidate facts (for reference):\n${JSON.stringify(compactProfile).slice(0, 12000)}\n\nCurrent HTML:\n${currentHtml}`
    : `Requested creative style:\n${stylePrompt}\n\nCandidate résumé data:\n${JSON.stringify(compactProfile).slice(0, 16000)}`;

  const cost = mode === "byok" ? 0 : isRefine ? CREDIT_COST.edit : CREDIT_COST.generate;

  return withCreationCredits(user?.email, cost, env, request, async (signal) => {
    const callModel = (targetModel: string) =>
      fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: targetModel,
          ...(isReasoningOrNextGenOpenAI(targetModel) ? {} : { temperature: 0.7 }),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
      });

    let upstream = await callModel(model);
    if ([400, 404].includes(upstream.status) && baseUrl === "https://api.deepseek.com/v1" && model !== "deepseek-chat") {
      upstream = await callModel("deepseek-chat");
    }
    if (upstream.status !== 200) {
      return jsonResponse(upstream.status === 401 ? 401 : 502, {
        error: upstream.status === 401 ? "Invalid API key." : `AI provider returned HTTP ${upstream.status}.`,
      });
    }

    const payload = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content ?? "";
    const stripped = stripMarkdownFences(rawContent);
    const hydrated = hydrateCustomHtmlPlaceholders(stripped, profile);
    const cleanHtml = sanitizeCustomHtml(hydrated);

    if (!cleanHtml || !/<(?:!doctype|html|body|section|main|div|style)\b/i.test(cleanHtml)) {
      throw new Error("AI did not return valid HTML.");
    }

    return { ok: true, html: cleanHtml };
  });
}
