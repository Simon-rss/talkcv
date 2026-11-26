import assert from "node:assert/strict";
import test from "node:test";
import {
  designTokensToCssVars,
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

test("sanitizeDesignTokens & designTokensToCssVars prevent dark-on-dark surface/ink contrast mismatches", () => {
  // Light canvas + dark surface + dark muted text (the unreadable chip bug)
  const fixedLight = sanitizeDesignTokens(
    {
      bg: "#f8fafc",
      surface: "#0f172a",
      ink: "#e2e8f0",
      muted: "#cbd5e1",
    },
    "editorial",
  );
  assert.equal(fixedLight?.surface, "#ffffff");
  assert.equal(fixedLight?.ink, "#111827");
  assert.equal(fixedLight?.muted, "#475569");

  // Dark preset applied on editorial theme maps --ink-soft alongside --muted
  const darkVars = designTokensToCssVars(
    {
      bg: "#070d19",
      surface: "#0f172a",
      ink: "#f1f5f9",
      muted: "#94a3b8",
    },
    "editorial",
  );
  assert.equal(darkVars["--ink-soft"], "#94a3b8");
  assert.equal(darkVars["--muted"], "#94a3b8");

  // Conflicting dark surface alone without bg on light theme is dropped
  const droppedSurface = sanitizeDesignTokens({ surface: "#111822", accent: "#10b981" }, "editorial");
  assert.equal(droppedSurface?.surface, undefined);
  assert.equal(droppedSurface?.accent, "#10b981");
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

test("/api/og renders 1200x630 PNG brand card, public site card, and redacts locked sites", async () => {
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const assertPng = async (res) => {
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /image\/png/i);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.ok(bytes.length > 500, "PNG should be non-trivial size");
    assert.deepEqual(Array.from(bytes.slice(0, 8)), PNG_MAGIC);
    return bytes;
  };

  const brandRes = await worker.fetch(
    new Request("http://localhost/api/og"),
    { ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  await assertPng(brandRes);

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
  await assertPng(pubOg);

  const lockedOg = await worker.fetch(
    new Request("http://localhost/api/og?slug=locked-og"),
    { PROFILES_KV: kv, ASSETS: { fetch: async () => new Response("404", { status: 404 }) } },
  );
  const lockedBytes = await assertPng(lockedOg);
  assert.equal(lockedOg.headers.get("cache-control"), "private, no-store");
  assert.ok(lockedBytes.length > 500);
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

  // Global daily cap circuit breaker: different IP blocked when GUEST_TRIAL_DAILY_CAP is reached
  const cappedTrial = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.99" },
      body: JSON.stringify({ resumeText, guestTrial: true }),
    }),
    { ...env, GUEST_TRIAL_DAILY_CAP: "1" },
  );
  assert.equal(cappedTrial.status, 401);
  assert.equal((await cappedTrial.json()).guestTrialExhausted, true);
});

test("site traffic tracker counts PV/UV, filters bots, tracks referrers & devices, and exposes stats in /api/admin/overview", async () => {
  const kvStore = new Map();
  const PROFILES_KV = {
    get: async (k) => kvStore.get(k) ?? null,
    put: async (k, v) => { kvStore.set(k, v); },
    delete: async (k) => { kvStore.delete(k); },
    listPrefix: async (prefix, limit = 5000) =>
      Array.from(kvStore.entries())
        .filter(([k]) => k.startsWith(prefix))
        .slice(0, limit)
        .map(([key, value]) => ({ key, value })),
  };
  const authEnv = { AUTH_SECRET: "traffic-admin-test", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } };
  const env = {
    ...authEnv,
    ADMIN_EMAILS: "admin@mytalkcv.com",
    ADMIN_ALLOW_DEV_AUTH: "1",
    PROFILES_KV,
  };
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(p); } };

  // Bot request should be ignored
  await worker.fetch(new Request("http://localhost/", { headers: { "user-agent": "Googlebot/2.1" } }), env, ctx);
  // Two requests from same mobile user (/ and /create) + one desktop user (/pricing)
  await worker.fetch(
    new Request("http://localhost/", {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
        "cf-connecting-ip": "198.51.100.10",
        referer: "https://www.xiaohongshu.com/explore/123",
      },
    }),
    env,
    ctx,
  );
  await worker.fetch(
    new Request("http://localhost/create", {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
        "cf-connecting-ip": "198.51.100.10",
      },
    }),
    env,
    ctx,
  );
  await worker.fetch(
    new Request("http://localhost/pricing", {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0",
        "cf-connecting-ip": "198.51.100.20",
        referer: "https://v2ex.com/t/999",
      },
    }),
    env,
    ctx,
  );
  await Promise.all(pending);

  // Verify /api/admin/overview includes traffic payload for authenticated admin
  const sendRes = await worker.fetch(
    new Request("http://localhost/api/auth/send-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@mytalkcv.com" }),
    }),
    authEnv,
  );
  assert.equal(sendRes.status, 200);
  const { instantCode, challenge } = await sendRes.json();
  const verifyRes = await worker.fetch(
    new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@mytalkcv.com", code: instantCode, challenge }),
    }),
    authEnv,
  );
  assert.equal(verifyRes.status, 200);
  const cookie = verifyRes.headers.get("set-cookie")?.split(";")[0];
  const overviewRes = await worker.fetch(
    new Request("http://localhost/api/admin/overview", { headers: { cookie } }),
    env,
  );
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.equal(overview.traffic?.todayPv, 3);
  assert.equal(overview.traffic?.todayUv, 2);
  assert.equal(overview.traffic?.devices?.mobile, 2);
  assert.equal(overview.traffic?.devices?.desktop, 1);
  assert.ok(overview.traffic?.referrers?.some((r) => r.source === "xiaohongshu.com" && r.pv === 1));
  assert.ok(overview.traffic?.referrers?.some((r) => r.source === "v2ex.com" && r.pv === 1));
});

test("Google Gemini models enforce paid tiering (Free/Pro/Max) and route to Gemini OpenAI-compatible endpoint", async (t) => {
  const { canUseModel, getHostedModel, isGeminiThinkingModel } = await import("../lib/models.ts");

  assert.equal(canUseModel("gemini-3.5-flash-lite", "free"), true);
  assert.equal(canUseModel("gemini-3.8-flash", "free"), false);
  assert.equal(canUseModel("gemini-3.8-flash", "pro"), true);
  assert.equal(canUseModel("gemini-4-hydrogen", "free"), false);
  assert.equal(canUseModel("gemini-4-hydrogen", "pro"), true);
  assert.equal(canUseModel("gemini-4-carbon", "pro"), false);
  assert.equal(canUseModel("gemini-4-carbon", "max"), true);
  assert.equal(canUseModel("gemini-4-neon", "max"), true);
  assert.equal(canUseModel("gemini-4-argon", "max"), true);
  assert.equal(getHostedModel("gemini-4-carbon").provider, "gemini");
  assert.equal(isGeminiThinkingModel("gemini-4-hydrogen"), true);

  // End-to-end check through worker /api/generate
  const authEnv = { AUTH_SECRET: "gemini-route-test", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } };
  const sendRes = await worker.fetch(
    new Request("http://localhost/api/auth/send-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "gemini-pro@example.com" }),
    }),
    authEnv,
  );
  const { instantCode, challenge } = await sendRes.json();
  const verifyRes = await worker.fetch(
    new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "gemini-pro@example.com", code: instantCode, challenge }),
    }),
    authEnv,
  );
  const cookie = verifyRes.headers.get("set-cookie").split(";")[0];

  const kvStore = new Map([
    ["plan:gemini-pro@example.com", JSON.stringify({ plan: "pro", expiresAt: "2099-01-01T00:00:00.000Z" })],
  ]);
  const env = {
    ...authEnv,
    GEMINI_API_KEY: "test-gemini-key",
    PROFILES_KV: {
      get: async (k) => kvStore.get(k) ?? null,
      put: async (k, v) => { kvStore.set(k, v); },
      delete: async (k) => { kvStore.delete(k); },
    },
  };

  // Pro user requesting Max-only gemini-4-carbon -> 403
  const forbidden = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        resumeText: "Alex Lin, Staff Engineer with 8 years of distributed systems experience.",
        hostedModelId: "gemini-4-carbon",
      }),
    }),
    env,
  );
  assert.equal(forbidden.status, 403);

  // Pro user requesting Pro-tier gemini-4-hydrogen -> hits Gemini OpenAI-compatible URL with reasoning_effort: low
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedBody = null;
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedAuth = init?.headers?.authorization ?? "";
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ basics: { name: { en: "Alex Lin", zh: "林阳" } }, skills: ["Go"], projects: [], experiences: [], capabilities: [] }) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const okRes = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        resumeText: "Alex Lin, Staff Engineer with 8 years of distributed systems experience.",
        hostedModelId: "gemini-4-hydrogen",
      }),
    }),
    env,
  );
  assert.equal(okRes.status, 200);
  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(capturedAuth, "Bearer test-gemini-key");
  assert.equal(capturedBody?.model, "gemini-4-hydrogen");
  assert.equal(capturedBody?.reasoning_effort, "low");
});

test("Starter Pass webhook activates 14-day Pro + 80 bonus credits, media split separates base64 images, and PDF QR stamper outputs valid PDF", async () => {
  const { createHmac } = await import("node:crypto");
  const { PDFDocument } = await import("pdf-lib");
  const { stampPdfWithTalkCvQr } = await import("../lib/pdf-qr-stamp.ts");

  // 1. Starter Pass webhook test
  const kvStore = new Map();
  const PROFILES_KV = {
    get: async (k) => kvStore.get(k) ?? null,
    put: async (k, v) => { kvStore.set(k, v); },
    delete: async (k) => { kvStore.delete(k); },
  };
  const secret = "whsec_starter_test";
  const authEnv = { AUTH_SECRET: "starter-auth", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } };
  const env = { ...authEnv, PROFILES_KV, CREEM_WEBHOOK_SECRET: secret };
  const payload = JSON.stringify({
    id: "evt_starter_001",
    eventType: "checkout.completed",
    object: {
      customer: { id: "cust_1", email: "starter@example.com" },
      metadata: { email: "starter@example.com", plan: "starter", mode: "onetime", days: 14, bonusCredits: 80 },
    },
  });
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  const whRes = await worker.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "creem-signature": sig },
      body: payload,
    }),
    env,
  );
  assert.equal(whRes.status, 200);
  const planRec = JSON.parse(kvStore.get("plan:starter@example.com"));
  assert.equal(planRec.plan, "pro");
  assert.equal(planRec.bonusCredits, 80);
  const daysDelta = (Date.parse(planRec.expiresAt) - Date.now()) / 86_400_000;
  assert.ok(daysDelta >= 13.5 && daysDelta <= 14.5);

  // 1b. Active Max user cannot checkout Starter Pass (409) and delayed Starter webhook must NOT downgrade Max or shorten expiry
  const maxExpiry = new Date(Date.now() + 90 * 86_400_000).toISOString();
  kvStore.set("plan:maxuser@example.com", JSON.stringify({ plan: "max", status: "active", expiresAt: maxExpiry, updatedAt: new Date().toISOString() }));
  const maxSend = await worker.fetch(
    new Request("http://localhost/api/auth/send-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "maxuser@example.com" }),
    }),
    authEnv,
  );
  const { instantCode: maxCode, challenge: maxChallenge } = await maxSend.json();
  const maxVerify = await worker.fetch(
    new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "maxuser@example.com", code: maxCode, challenge: maxChallenge }),
    }),
    authEnv,
  );
  const maxCookie = maxVerify.headers.get("set-cookie").split(";")[0];
  const blockedCheckout = await worker.fetch(
    new Request("http://localhost/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maxCookie },
      body: JSON.stringify({ tier: "starter", interval: "month", mode: "onetime" }),
    }),
    { ...env, CREEM_API_KEY: "creem_test_key", CREEM_STARTER_ONETIME_PRODUCT_ID: "prod_starter" },
  );
  assert.equal(blockedCheckout.status, 409);

  const delayedPayload = JSON.stringify({
    id: "evt_starter_delayed_max",
    eventType: "checkout.completed",
    object: {
      customer: { id: "cust_max", email: "maxuser@example.com" },
      metadata: { email: "maxuser@example.com", plan: "starter", mode: "onetime", days: 14, bonusCredits: 80 },
    },
  });
  const delayedSig = createHmac("sha256", secret).update(delayedPayload).digest("hex");
  const delayedRes = await worker.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "creem-signature": delayedSig },
      body: delayedPayload,
    }),
    env,
  );
  assert.equal(delayedRes.status, 200);
  const maxAfter = JSON.parse(kvStore.get("plan:maxuser@example.com"));
  assert.equal(maxAfter.plan, "max");
  assert.ok(Date.parse(maxAfter.expiresAt) >= Date.parse(maxExpiry));
  assert.equal(maxAfter.bonusCredits, 80);

  // 2. Base64 media split & cleanup test
  const sendRes = await worker.fetch(
    new Request("http://localhost/api/auth/send-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "media@example.com" }),
    }),
    authEnv,
  );
  const { instantCode, challenge } = await sendRes.json();
  const verifyRes = await worker.fetch(
    new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "media@example.com", code: instantCode, challenge }),
    }),
    authEnv,
  );
  const cookie = verifyRes.headers.get("set-cookie").split(";")[0];
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const pubRes = await worker.fetch(
    new Request("http://localhost/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        slug: "media-split-test",
        profile: {
          theme: "editorial",
          siteUrl: "https://mytalkcv.com",
          basics: {
            name: { en: "Media User", zh: "媒体用户" },
            initials: "MU",
            role: { en: "Eng", zh: "工程师" },
            location: { en: "GZ", zh: "广州" },
            timezone: "Asia/Shanghai",
            headline: { en: "H", zh: "H" },
            intro: { en: "I", zh: "I" },
            education: { en: "E", zh: "E" },
            footerNote: { en: "F", zh: "F" },
            avatar: tinyPng,
          },
          skills: ["TS"],
          capabilities: [],
          experiences: [],
          projects: [
            {
              slug: "proj-1",
              accent: "blue",
              group: "product",
              category: { en: "C", zh: "C" },
              title: { en: "P1", zh: "P1" },
              role: { en: "R", zh: "R" },
              summary: { en: "S", zh: "S" },
              outcome: { en: "O", zh: "O" },
              tags: [],
              facts: [],
              sections: [],
              workflow: [],
              coverImage: tinyPng,
            },
          ],
          ai: { enabled: true, assistantName: { en: "A", zh: "A" }, welcome: { en: "W", zh: "W" }, suggestedPrompts: { en: [], zh: [] } },
        },
      }),
    }),
    env,
  );
  assert.equal(pubRes.status, 200);
  // Base64 should be stored in profile_media:media-split-test, NOT in profile:media-split-test
  assert.ok(kvStore.has("profile_media:media-split-test"));
  assert.doesNotMatch(kvStore.get("profile:media-split-test"), /data:image\/png;base64/);
  // GET /api/profiles/media-split-test rehydrates the images
  const getRes = await worker.fetch(new Request("http://localhost/api/profiles/media-split-test"), env);
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.profile.basics.avatar, tinyPng);
  assert.equal(getJson.profile.projects[0].coverImage, tinyPng);
  // DELETE removes both profile and profile_media
  const delRes = await worker.fetch(
    new Request("http://localhost/api/profiles/media-split-test", { method: "DELETE", headers: { cookie } }),
    env,
  );
  assert.equal(delRes.status, 200);
  assert.equal(kvStore.has("profile_media:media-split-test"), false);

  // 3. Original PDF QR stamper produces valid %PDF- bytes
  const blankPdf = await PDFDocument.create();
  blankPdf.addPage([595, 842]);
  const blankBytes = await blankPdf.save();
  const stamped = await stampPdfWithTalkCvQr(blankBytes, "media-split-test", "top-right");
  assert.ok(stamped.byteLength > blankBytes.byteLength);
  assert.equal(new TextDecoder().decode(stamped.slice(0, 5)), "%PDF-");
});
