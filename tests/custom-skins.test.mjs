import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeCoverImage,
  sanitizeCustomHtml,
  sanitizeDesignTokens,
  sanitizeLayoutPlan,
  STYLE_PRESETS,
} from "../lib/schema.ts";
import worker from "../dist/server/index.js";

test("sanitizeDesignTokens keeps valid deep skin properties and drops invalid values", () => {
  const clean = sanitizeDesignTokens({
    accent: "#2997ff",
    accent2: "#6e6eff",
    bg: "#000000",
    surface: "#111318",
    ink: "#f5f5f7",
    muted: "#a1a1a6",
    radius: "22px",
    bgPattern: "glow",
    cardStyle: "glass",
    buttonStyle: "pill",
  });
  assert.deepEqual(clean, {
    accent: "#2997ff",
    accent2: "#6e6eff",
    bg: "#000000",
    surface: "#111318",
    ink: "#f5f5f7",
    muted: "#a1a1a6",
    radius: "22px",
    bgPattern: "glow",
    cardStyle: "glass",
    buttonStyle: "pill",
  });

  const rejected = sanitizeDesignTokens({
    accent: "javascript:alert(1)",
    bgPattern: "invalid",
    cardStyle: "evil",
    buttonStyle: "bad",
    radius: "999px",
  });
  assert.equal(rejected, undefined);
});

test("sanitizeLayoutPlan normalizes sectionOrder and validates all layout dimensions", () => {
  const plan = sanitizeLayoutPlan({
    heroStyle: "sidebar-dossier",
    projectLayout: "editorial-rows",
    fontPair: "serif-editorial",
    sectionOrder: ["experience", "work"],
  });
  assert.deepEqual(plan, {
    heroStyle: "sidebar-dossier",
    projectLayout: "editorial-rows",
    fontPair: "serif-editorial",
    sectionOrder: ["experience", "work", "capabilities", "contact"],
  });
});

test("sanitizeCoverImage accepts safe image data URLs and HTTPS URLs only", () => {
  assert.equal(sanitizeCoverImage("data:image/webp;base64,UklGRh4AAABXRUJQVlA4"), "data:image/webp;base64,UklGRh4AAABXRUJQVlA4");
  assert.equal(sanitizeCoverImage("https://mytalkcv.com/cover.png"), "https://mytalkcv.com/cover.png");
  assert.equal(sanitizeCoverImage("javascript:alert(1)"), undefined);
  assert.equal(sanitizeCoverImage("data:text/html;base64,PHNjcmlwdD4="), undefined);
});

test("sanitizeCustomHtml strips scripts, iframes, inline event handlers, and javascript URLs", () => {
  const dirty = `<!DOCTYPE html><html><head><style>body{color:#fff}</style></head><body onload="alert(1)"><script>steal()</script><iframe src="https://evil.com"></iframe><a href="javascript:alert(2)" onclick="hack()">Click</a><main>Safe</main></body></html>`;
  const clean = sanitizeCustomHtml(dirty);
  assert.ok(clean);
  assert.ok(!clean.includes("<script"));
  assert.ok(!clean.includes("<iframe"));
  assert.ok(!clean.includes("onload="));
  assert.ok(!clean.includes("onclick="));
  assert.ok(!clean.includes("javascript:"));
  assert.ok(clean.includes("<main>Safe</main>"));
});

test("built-in STYLE_PRESETS include Apple Keynote, Retro Win95, and Black & Gold Monograph", () => {
  const ids = STYLE_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("apple-keynote"));
  assert.ok(ids.includes("retro-win95"));
  assert.ok(ids.includes("black-gold-arch"));
  for (const preset of STYLE_PRESETS) {
    assert.ok(sanitizeDesignTokens(preset.designTokens), `preset ${preset.id} designTokens valid`);
    assert.ok(sanitizeLayoutPlan(preset.layoutPlan), `preset ${preset.id} layoutPlan valid`);
  }
});

test("/api/generate-custom enforces auth, hydrates cover placeholders, and strips XSS", async (t) => {
  const cover = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4";
  const miniProfile = {
    basics: { name: { en: "Alex", zh: "Alex" }, role: { en: "Engineer", zh: "工程师" }, avatar: cover },
    projects: [{ title: { en: "Demo", zh: "演示" }, coverImage: cover }],
    skills: ["TypeScript"],
    capabilities: [],
    experiences: [],
  };

  // Unauthenticated hosted call -> 401
  const unauthRes = await worker.fetch(
    new Request("http://localhost/api/generate-custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: miniProfile, stylePrompt: "Apple Keynote" }),
    }),
    { AUTH_SECRET: "custom-test", OPENAI_API_KEY: "test-key", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  assert.equal(unauthRes.status, 401);

  // BYOK call hydrates placeholders and strips scripts
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '```html\n<!DOCTYPE html><html><body><script>bad()</script><img src="{{PROJECT_IMG_0}}" /><main>Hello</main></body></html>\n```',
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const byokRes = await worker.fetch(
    new Request("http://localhost/api/generate-custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: miniProfile,
        stylePrompt: "Retro Win95",
        providerMode: "byok",
        apiKey: "sk-test-byok",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      }),
    }),
    { AUTH_SECRET: "custom-test", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  assert.equal(byokRes.status, 200);
  const data = await byokRes.json();
  assert.equal(data.ok, true);
  assert.ok(data.html.includes(`src="${cover}"`));
  assert.ok(!data.html.includes("<script"));
});
