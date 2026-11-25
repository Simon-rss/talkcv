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

test("/api/parse-resume-image enforces auth and validates image payload", async () => {
  const unauth = await worker.fetch(
    new Request("http://localhost/api/parse-resume-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrl: "data:image/jpeg;base64,AAAA" }),
    }),
    { AUTH_SECRET: "ocr-test", OPENAI_API_KEY: "test-key", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  assert.equal(unauth.status, 401);
});

test("/api/og renders brand card, public site card, and redacts locked sites", async () => {
  const brandRes = await worker.fetch(
    new Request("http://localhost/api/og"),
    { ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  assert.equal(brandRes.status, 200);
  assert.match(brandRes.headers.get("content-type") ?? "", /image\/svg\+xml/i);
  const brandSvg = await brandRes.text();
  assert.match(brandSvg, /TalkCV/);

  const store = new Map();
  const kv = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
  const future = new Date(Date.now() + 86_400_000).toISOString();
  store.set(
    "profile:public-og",
    JSON.stringify({
      slug: "public-og",
      expiresAt: future,
      profile: {
        basics: { name: { en: "Zhang Wei", zh: "张伟" }, role: { en: "PM", zh: "高级产品经理" }, headline: { en: "Builder", zh: "增长负责人" } },
        skills: ["SQL", "PLG"],
        projects: [{ facts: [{ value: "+42%", label: { en: "Lift", zh: "激活提升" } }] }],
      },
    }),
  );
  store.set(
    "profile:locked-og",
    JSON.stringify({
      slug: "locked-og",
      expiresAt: future,
      passcode: { salt: "s", hash: "h" },
      profile: {
        basics: { name: { en: "Secret Person", zh: "保密人物" }, role: { en: "CEO", zh: "CEO" }, headline: { en: "Top Secret", zh: "绝密" } },
        skills: [],
        projects: [],
      },
    }),
  );

  const pubOg = await worker.fetch(
    new Request("http://localhost/api/og?slug=public-og"),
    { PROFILES_KV: kv, ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  assert.equal(pubOg.status, 200);
  const pubSvg = await pubOg.text();
  assert.match(pubSvg, /张伟/);
  assert.match(pubSvg, /\+42%/);

  const lockedOg = await worker.fetch(
    new Request("http://localhost/api/og?slug=locked-og"),
    { PROFILES_KV: kv, ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  assert.equal(lockedOg.status, 200);
  const lockedSvg = await lockedOg.text();
  assert.doesNotMatch(lockedSvg, /保密人物|Secret Person|绝密/);
});

test("/api/generate keeps 401 for bare unauthenticated calls and enforces 1x/day guestTrial per IP", async (t) => {
  const resumeText = "Zhang Wei, Senior Product Manager with 6 years of SaaS onboarding, PLG, and AI copilot experience.";
  const env = {
    AUTH_SECRET: "guest-trial-test",
    OPENAI_API_KEY: "test-openai-key",
    ASSETS: { fetch: async () => new Response("404", { status: 404 }) },
  };

  // Bare unauthenticated request MUST remain 401
  const bareRes = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.55" },
      body: JSON.stringify({ resumeText }),
    }),
    env,
  );
  assert.equal(bareRes.status, 401);

  // Mock upstream LLM response for guestTrial
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                basics: { name: { en: "Zhang Wei", zh: "张伟" }, role: { en: "PM", zh: "产品经理" } },
                skills: ["PLG"],
                projects: [],
                experiences: [],
                capabilities: [],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  // First guestTrial from same IP -> 200 + guestTrialUsed: true
  const firstTrial = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.55" },
      body: JSON.stringify({ resumeText, guestTrial: true }),
    }),
    env,
  );
  assert.equal(firstTrial.status, 200);
  const firstJson = await firstTrial.json();
  assert.equal(firstJson.guestTrialUsed, true);
  assert.equal(firstJson.profile?.basics?.name?.zh, "张伟");

  // Second guestTrial from same IP on same day -> 401 guestTrialExhausted
  const secondTrial = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.55" },
      body: JSON.stringify({ resumeText, guestTrial: true }),
    }),
    env,
  );
  assert.equal(secondTrial.status, 401);
  const secondJson = await secondTrial.json();
  assert.equal(secondJson.guestTrialExhausted, true);
});
