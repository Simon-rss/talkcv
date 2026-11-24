import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProfile } from "../scripts/generate.mjs";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
  );
}

test("profile.json passes schema validation and contains zero private author data", async () => {
  const raw = await readFile(new URL("../data/profile.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw);
  const errors = validateProfile(parsed);
  assert.deepEqual(errors, []);
  assert.doesNotMatch(raw, /Ren Sishuo|rss1549596771|evose|tiwork|PRD-50|PRD-56/i);
});

test("SSR renders home page, case studies, and custom 404", async () => {
  const homeRes = await render("/");
  assert.equal(homeRes.status, 200);
  const homeHtml = await homeRes.text();
  assert.match(homeHtml, /Alex Chen/);
  assert.match(homeHtml, /data-theme="editorial"/);
  assert.match(homeHtml, /Pulse Agent Runtime/);
  assert.match(homeHtml, /application\/ld\+json/);

  const caseRes = await render("/projects/pulse-agent-runtime");
  assert.equal(caseRes.status, 200);
  const caseHtml = await caseRes.text();
  assert.match(caseHtml, /Pulse Agent Runtime/);
  assert.match(caseHtml, /min read/);

  const notFoundRes = await render("/projects/does-not-exist");
  assert.equal(notFoundRes.status, 404);
  const notFoundHtml = await notFoundRes.text();
  assert.match(notFoundHtml, /This page was eaten by an Agent/i);
});

test("serves dynamic /sitemap.xml, /robots.txt, /llms.txt, /resume.json, and /api/chat guard", async () => {
  const sitemapRes = await render("/sitemap.xml");
  assert.equal(sitemapRes.status, 200);
  assert.match(sitemapRes.headers.get("content-type") ?? "", /application\/xml/i);
  const sitemapXml = await sitemapRes.text();
  assert.match(sitemapXml, /\/projects\/pulse-agent-runtime/);
  assert.match(sitemapXml, /\/projects\/mesh-llm-gateway/);
  assert.match(sitemapXml, /\/projects\/evalbench-studio/);

  const robotsRes = await render("/robots.txt");
  assert.equal(robotsRes.status, 200);
  assert.match(await robotsRes.text(), /Sitemap:/);

  const llmsRes = await render("/llms.txt");
  assert.equal(llmsRes.status, 200);
  const llmsTxt = await llmsRes.text();
  assert.match(llmsTxt, /# Alex Chen/);
  assert.match(llmsTxt, /## Case studies/);

  const resumeRes = await render("/resume.json");
  assert.equal(resumeRes.status, 200);
  const resumeJson = await resumeRes.json();
  assert.equal(resumeJson.basics?.name, "Alex Chen");
  assert.equal(resumeJson.projects?.length, 3);

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-chat`);
  const { default: worker } = await import(workerUrl.href);
  const chatRes = await worker.fetch(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(chatRes.status, 503);

  // /create studio SSR + /api/generate validation
  const createRes = await render("/create");
  assert.equal(createRes.status, 200);
  const createHtml = await createRes.text();
  assert.match(createHtml, /TalkCV Studio/i);

  const genBadRes = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeText: "too short" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(genBadRes.status, 400);

  const genNoKeyRes = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resumeText: "Alex Chen, Senior Engineer with 6 years building Python, TypeScript, and AI Agent platforms.",
      }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(genNoKeyRes.status, 401);

  // /api/publish + /api/profiles/:slug + /u/:slug round-trip
  const demoProfile = JSON.parse(await readFile(new URL("../data/profile.json", import.meta.url), "utf8"));
  const pubRes = await worker.fetch(
    new Request("http://localhost/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "demo-user", profile: demoProfile }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(pubRes.status, 200);
  const pubJson = await pubRes.json();
  assert.equal(pubJson.slug, "demo-user");
  assert.match(pubJson.url, /\/u\/demo-user$/);

  const getRes = await worker.fetch(
    new Request("http://localhost/api/profiles/demo-user"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.profile?.basics?.name?.en, "Alex Chen");

  const uPageRes = await render("/u/demo-user");
  assert.equal(uPageRes.status, 404); // fresh worker instance has empty memory store -> must return 404!
  const uHtml = await uPageRes.text();
  assert.doesNotMatch(uHtml, /Alex Chen/);

  // Pro hosted model is blocked on free tier; BYOK key is encrypted & masked
  const proBlockRes = await worker.fetch(
    new Request("http://localhost/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "pro-test",
        profile: demoProfile,
        chatConfig: { mode: "hosted", hostedModelId: "deepseek-reasoner" },
      }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(proBlockRes.status, 403);

  const byokPubRes = await worker.fetch(
    new Request("http://localhost/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "byok-site",
        profile: demoProfile,
        chatConfig: {
          mode: "byok",
          byokApiKey: "sk-test-secret-key-998877",
          byokBaseUrl: "https://api.deepseek.com/v1",
          byokModel: "deepseek-v4.1-flash",
        },
      }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(byokPubRes.status, 200);
  const byokPubJson = await byokPubRes.json();
  assert.equal(byokPubJson.chatMeta?.hasByokKey, true);
  assert.doesNotMatch(JSON.stringify(byokPubJson), /sk-test-secret-key-998877/);

  // Email auth flow (/api/auth/send-code -> /api/auth/verify -> /api/auth/me)
  const sendRes = await worker.fetch(
    new Request("http://localhost/api/auth/send-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "tester@example.com" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(sendRes.status, 200);
  const sendJson = await sendRes.json();
  assert.equal(sendJson.ok, true);
  assert.match(sendJson.instantCode ?? "", /^\d{6}$/);

  const verifyRes = await worker.fetch(
    new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "tester@example.com",
        code: sendJson.instantCode,
        challenge: sendJson.challenge,
      }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(verifyRes.status, 200);
  const setCookie = verifyRes.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /talkcv_session=/);
  const cookiePair = setCookie.split(";")[0];

  const meRes = await worker.fetch(
    new Request("http://localhost/api/auth/me", {
      headers: { cookie: cookiePair },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(meRes.status, 200);
  const meJson = await meRes.json();
  assert.equal(meJson.user?.email, "tester@example.com");
  assert.equal(meJson.user?.dailyLimit, 3);
  assert.equal(meJson.user?.isPro, false);

  // Creem billing webhook HMAC verification & Pro upgrade
  const { createHmac } = await import("node:crypto");
  const whSecret = "whsec_unit_test_secret";
  const whPayload = JSON.stringify({
    id: "evt_test_pro_001",
    eventType: "checkout.completed",
    object: {
      customer: { id: "cust_test_1", email: "tester@example.com" },
      metadata: { email: "tester@example.com", plan: "pro" },
    },
  });
  const badWhRes = await worker.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "creem-signature": "bad_sig" },
      body: whPayload,
    }),
    { CREEM_WEBHOOK_SECRET: whSecret, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(badWhRes.status, 401);

  const validSig = createHmac("sha256", whSecret).update(whPayload).digest("hex");
  const okWhRes = await worker.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "creem-signature": validSig },
      body: whPayload,
    }),
    { CREEM_WEBHOOK_SECRET: whSecret, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(okWhRes.status, 200);

  const meProRes = await worker.fetch(
    new Request("http://localhost/api/auth/me", {
      headers: { cookie: cookiePair },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  const meProJson = await meProRes.json();
  assert.equal(meProJson.user?.isPro, true);
  assert.equal(meProJson.user?.dailyLimit, 30);
  assert.equal(meProJson.user?.quotaPeriod, "month");
  assert.equal(meProJson.user?.editDailyLimit, 100);

  // AI Live Edit requires Pro/Max when not using BYOK
  const unauthEditRes = await worker.fetch(
    new Request("http://localhost/api/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: { basics: { name: { en: "Test", zh: "测试" } } },
        instruction: "Make headline shorter",
      }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(unauthEditRes.status, 401);

  // Admin mint redeem code & user redeem flow
  const mintBad = await worker.fetch(
    new Request("http://localhost/api/billing/admin/codes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-secret" },
      body: JSON.stringify({ code: "TALKCV-BETA-001", days: 30, maxUses: 1 }),
    }),
    { AUTH_SECRET: "test-admin-secret", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(mintBad.status, 401);

  const mintOk = await worker.fetch(
    new Request("http://localhost/api/billing/admin/codes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-admin-secret" },
      body: JSON.stringify({ code: "TALKCV-BETA-001", days: 30, maxUses: 1 }),
    }),
    { AUTH_SECRET: "test-admin-secret", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(mintOk.status, 200);

  const redeemOk = await worker.fetch(
    new Request("http://localhost/api/billing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiePair },
      body: JSON.stringify({ code: "talkcv-beta-001" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(redeemOk.status, 200);
  const redeemJson = await redeemOk.json();
  assert.equal(redeemJson.isPro, true);
  assert.equal(redeemJson.days, 30);

  const redeemDup = await worker.fetch(
    new Request("http://localhost/api/billing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookiePair },
      body: JSON.stringify({ code: "TALKCV-BETA-001" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  );
  assert.equal(redeemDup.status, 409);
});
