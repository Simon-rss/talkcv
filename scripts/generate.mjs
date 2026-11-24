#!/usr/bin/env node
/**
 * TalkCV CLI: Convert any resume (.md / .txt / .docx / .pdf) + API key
 * into a structured bilingual data/profile.json with selectable themes.
 *
 * Usage:
 *   npm run generate
 *   npm run generate -- --resume ./resume.md --theme terminal --site https://me.dev
 *   npm run validate
 */
import { normalizeContacts } from "../lib/contacts.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE_PATH = path.join(ROOT, "data", "profile.json");
const VALID_THEMES = ["editorial", "terminal", "bento"];
const VALID_ACCENTS = ["mint", "blue", "coral", "amber"];
const VALID_GROUPS = ["platform", "enterprise", "product"];

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    try {
      const content = execFileSync("cat", [file], { encoding: "utf8" });
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore unreadable .env
    }
  }
}

function parseArgs(argv) {
  const args = { validate: false, resume: "", theme: "", site: "", model: "", baseUrl: "", apiKey: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--validate") args.validate = true;
    else if (arg === "--resume" && argv[i + 1]) args.resume = argv[++i];
    else if (arg === "--theme" && argv[i + 1]) args.theme = argv[++i];
    else if (arg === "--site" && argv[i + 1]) args.site = argv[++i];
    else if (arg === "--model" && argv[i + 1]) args.model = argv[++i];
    else if (arg === "--base-url" && argv[i + 1]) args.baseUrl = argv[++i];
    else if (arg === "--api-key" && argv[i + 1]) args.apiKey = argv[++i];
  }
  return args;
}

export function validateProfile(data) {
  const errors = [];
  if (!data || typeof data !== "object") return ["Profile must be a JSON object."];
  if (!VALID_THEMES.includes(data.theme)) errors.push(`theme must be one of: ${VALID_THEMES.join(", ")}`);
  if (typeof data.siteUrl !== "string" || !data.siteUrl.startsWith("http")) {
    errors.push("siteUrl must be a valid http(s) URL");
  }
  if (!data.basics || typeof data.basics !== "object") {
    errors.push("basics object is required");
  } else {
    if (!data.basics.name?.en) errors.push("basics.name.en is required");
    const contacts = normalizeContacts(data.basics);
    for (const key of Object.keys(contacts)) {
      if (data.basics[key] && !contacts[key]) errors.push(`basics.${key} is not a valid contact`);
    }
    if (!data.basics.headline?.en) errors.push("basics.headline.en is required");
  }
  if (!Array.isArray(data.projects)) {
    errors.push("projects must be an array");
  } else {
    const seen = new Set();
    for (const [idx, project] of data.projects.entries()) {
      if (!project?.slug || !/^[a-z0-9-]+$/.test(project.slug)) {
        errors.push(`projects[${idx}].slug must be lowercase kebab-case`);
      } else if (seen.has(project.slug)) {
        errors.push(`duplicate project slug: ${project.slug}`);
      } else {
        seen.add(project.slug);
      }
      if (!project?.title?.en) errors.push(`projects[${idx}].title.en is required`);
    }
  }
  if (!Array.isArray(data.experiences)) errors.push("experiences must be an array");
  return errors;
}

async function extractResumeText(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Resume file not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();

  if (ext === ".md" || ext === ".txt" || ext === ".json") {
    return await readFile(resolved, "utf8");
  }

  if (ext === ".docx") {
    const xml = execFileSync("unzip", ["-p", resolved, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (ext === ".pdf") {
    try {
      return execFileSync("pdftotext", [resolved, "-"], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      }).trim();
    } catch {
      try {
        return execFileSync(
          "python3",
          [
            "-c",
            "import sys; from pypdf import PdfReader; r = PdfReader(sys.argv[1]); print('\\n'.join((p.extract_text() or '') for p in r.pages))",
            resolved,
          ],
          { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
        ).trim();
      } catch {
        throw new Error(
          "Could not extract PDF text automatically. Install `pdftotext` (poppler) or `pypdf`, or save your resume as .md / .txt / .docx.",
        );
      }
    }
  }

  throw new Error(`Unsupported file extension "${ext}". Supported: .md, .txt, .docx, .pdf, .json`);
}

export function normalizeProfile(raw, { theme, siteUrl, resumeText }) {
  const slugify = (str, fallback) =>
    String(str || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback;

  const loc = (v, fallback = "") => {
    if (!v) return { en: fallback, zh: fallback };
    if (typeof v === "string") return { en: v, zh: v };
    return { en: String(v.en || v.zh || fallback), zh: String(v.zh || v.en || fallback) };
  };

  const projects = (Array.isArray(raw.projects) ? raw.projects : []).map((p, idx) => ({
    slug: slugify(p.slug || p.title?.en, `project-${idx + 1}`),
    accent: VALID_ACCENTS.includes(p.accent) ? p.accent : VALID_ACCENTS[idx % VALID_ACCENTS.length],
    group: VALID_GROUPS.includes(p.group) ? p.group : VALID_GROUPS[idx % VALID_GROUPS.length],
    category: loc(p.category, "FEATURED PROJECT"),
    title: loc(p.title, `Project ${idx + 1}`),
    role: loc(p.role, "Engineer"),
    summary: loc(p.summary, ""),
    outcome: loc(p.outcome || p.summary, ""),
    tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 6) : [],
    facts: (Array.isArray(p.facts) ? p.facts : []).slice(0, 4).map((f) => ({
      value: String(f?.value ?? ""),
      label: loc(f?.label, ""),
    })),
    links: Array.isArray(p.links)
      ? p.links
          .filter((l) => l && typeof l.href === "string" && l.href.startsWith("http"))
          .map((l) => ({ label: loc(l.label, "Link"), href: l.href }))
      : [],
    sections:
      Array.isArray(p.sections) && p.sections.length > 0
        ? p.sections.map((s) => ({
            eyebrow: loc(s.eyebrow, "DETAILS"),
            title: loc(s.title, "Architecture & Delivery"),
            body: loc(s.body, ""),
            ...(Array.isArray(s.items) && s.items.length > 0
              ? { items: s.items.map((it) => loc(it, "")) }
              : {}),
          }))
        : [
            {
              eyebrow: { en: "OVERVIEW", zh: "项目概述" },
              title: loc(p.title, "Overview"),
              body: loc(p.summary, ""),
            },
          ],
    workflow:
      Array.isArray(p.workflow) && p.workflow.length > 0
        ? p.workflow.map((w, wIdx) => ({
            number: String(w.number || `0${wIdx + 1}`),
            title: loc(w.title, `Step ${wIdx + 1}`),
            text: loc(w.text, ""),
          }))
        : [],
  }));

  const name = loc(raw.basics?.name, "Portfolio Owner");
  const initials =
    String(raw.basics?.initials || "")
      .trim()
      .slice(0, 2)
      .toUpperCase() ||
    name.en
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ||
    "AF";

  return {
    theme: VALID_THEMES.includes(theme) ? theme : VALID_THEMES.includes(raw.theme) ? raw.theme : "editorial",
    siteUrl: (siteUrl || raw.siteUrl || "https://example.com").replace(/\/+$/, ""),
    basics: {
      name,
      initials,
      role: loc(raw.basics?.role, "Software Engineer"),
      location: loc(raw.basics?.location, "Remote"),
      timezone: String(raw.basics?.timezone || "UTC"),
      ...normalizeContacts(raw.basics || {}, resumeText),
      headline: loc(raw.basics?.headline, "Building reliable software systems."),
      intro: loc(raw.basics?.intro, ""),
      education: loc(raw.basics?.education, ""),
      footerNote: loc(
        raw.basics?.footerNote,
        "Built with TalkCV · Open-source Interactive Resume",
      ),
    },
    skills: Array.isArray(raw.skills) ? raw.skills.map(String).slice(0, 18) : [],
    capabilities: (Array.isArray(raw.capabilities) ? raw.capabilities : []).slice(0, 4).map((c) => ({
      title: loc(c.title, "Core Capability"),
      summary: loc(c.summary, ""),
    })),
    experiences: (Array.isArray(raw.experiences) ? raw.experiences : []).map((e) => ({
      period: String(e.period || ""),
      company: loc(e.company, ""),
      role: loc(e.role, ""),
      summary: loc(e.summary, ""),
    })),
    projects,
    ai: {
      enabled: raw.ai?.enabled !== false,
      assistantName: loc(raw.ai?.assistantName, `${name.en.split(" ")[0]}'s AI Agent`),
      welcome: loc(
        raw.ai?.welcome,
        `Hi! Ask me about ${name.en}'s projects, engineering trade-offs, or paste a JD for an honest match report.`,
      ),
      suggestedPrompts: {
        en: Array.isArray(raw.ai?.suggestedPrompts?.en) && raw.ai.suggestedPrompts.en.length > 0
          ? raw.ai.suggestedPrompts.en.slice(0, 3).map(String)
          : [
              "Walk me through the strongest project",
              "Switch theme to Terminal mode",
              "Draft an interview invite email",
            ],
        zh: Array.isArray(raw.ai?.suggestedPrompts?.zh) && raw.ai.suggestedPrompts.zh.length > 0
          ? raw.ai.suggestedPrompts.zh.slice(0, 3).map(String)
          : [
              "介绍一下最硬核的代表项目",
              "切换成暗黑极客主题看看",
              "帮我起草一封面试邀约邮件",
            ],
      },
      guardrails: Array.isArray(raw.ai?.guardrails) ? raw.ai.guardrails.map(String) : [],
    },
  };
}

async function generateFromResume({ resumeText, apiKey, baseUrl, model }) {
  const sampleProfile = await readFile(PROFILE_PATH, "utf8");

  const systemPrompt = `You are a precise portfolio data compiler. Convert the provided resume into a valid JSON object matching the exact schema of TalkCV's data/profile.json.

Rules:
Copy only contact details from the resume to basics.email, github, wechat (ID), linkedin and portfolio (blog or personal URL). Omit missing contacts.
1. Output ONLY valid JSON (no markdown fences, no commentary).
2. Every localized field must have both "en" and "zh" strings. Translate faithfully if the source resume is in only one language.
3. Extract up to 6 projects actually described in the résumé, with its own metrics, architecture details and workflow steps. If there are none, return projects: [].
4. NEVER fabricate metrics, companies, or skills not supported by the resume.
5. Keep slugs lowercase kebab-case ASCII (e.g. "realtime-order-engine").

Reference schema example:
${sampleProfile}`;

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Convert this resume into TalkCV profile.json:\n\n${resumeText.slice(0, 16000)}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API returned ${res.status}: ${errText.slice(0, 300)}`);
  }

  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned empty content.");
  }

  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(cleaned);
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.validate) {
    const raw = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
    const errors = validateProfile(raw);
    if (errors.length > 0) {
      console.error("❌ data/profile.json validation failed:");
      for (const err of errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(`✅ data/profile.json is valid (theme: ${raw.theme}, projects: ${raw.projects.length}).`);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    console.log("\n✨ TalkCV Generator — Turn your resume into a website that talks back\n");

    const resumePath =
      args.resume ||
      (await rl.question("1. Path to your resume (.md / .txt / .docx / .pdf): ")).trim();
    if (!resumePath) throw new Error("Resume path is required.");

    let theme = args.theme;
    if (!theme) {
      console.log("\nChoose a theme template:");
      console.log("  1) editorial  — Warm ivory paper, crisp ink, emerald accents");
      console.log("  2) terminal   — Obsidian dark mode, phosphor green, monospace");
      console.log("  3) bento      — Modern rounded Bento grid, indigo-blue accents");
      const pick = (await rl.question("2. Theme [1/2/3 or name, default: editorial]: ")).trim().toLowerCase();
      theme =
        pick === "2" || pick === "terminal"
          ? "terminal"
          : pick === "3" || pick === "bento"
            ? "bento"
            : "editorial";
    }

    const siteUrl =
      args.site ||
      (await rl.question("3. Your planned site URL (default: https://example.com): ")).trim() ||
      "https://example.com";

    const apiKey =
      args.apiKey ||
      process.env.OPENAI_API_KEY ||
      (await rl.question("4. OpenAI-compatible API Key (OPENAI_API_KEY): ")).trim();
    if (!apiKey) throw new Error("An API key is required to parse your resume.");

    const baseUrl =
      args.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      (await rl.question("5. API Base URL (default: https://api.openai.com/v1): ")).trim() ||
      "https://api.openai.com/v1";

    const model =
      args.model ||
      process.env.OPENAI_MODEL ||
      (await rl.question("6. Model name (default: gpt-4o-mini): ")).trim() ||
      "gpt-4o-mini";

    console.log(`\n📄 Extracting text from ${resumePath}...`);
    const resumeText = await extractResumeText(resumePath);
    console.log(`🤖 Calling ${model} via ${baseUrl} to generate bilingual profile.json...`);

    const rawGenerated = await generateFromResume({ resumeText, apiKey, baseUrl, model });
    const normalized = normalizeProfile(rawGenerated, { theme, siteUrl, resumeText });
    const errors = validateProfile(normalized);
    if (errors.length > 0) {
      throw new Error(`Generated profile failed validation:\n${errors.join("\n")}`);
    }

    await writeFile(PROFILE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    console.log(`\n✅ Wrote ${PROFILE_PATH}`);
    console.log(`   Theme: ${normalized.theme} | Projects: ${normalized.projects.length} | Experiences: ${normalized.experiences.length}`);
    console.log("\nNext steps:");
    console.log("  1. Review/tweak data/profile.json if needed");
    console.log("  2. Run `npm run dev` to preview all 3 themes live");
    console.log("  3. Deploy to Cloudflare Workers or Vercel\n");
  } finally {
    rl.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
