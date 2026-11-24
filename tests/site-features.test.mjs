import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";

function call(path, { method = "GET", body, cookie, env = {}, headers = {} } = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, ...env });
}

async function login(email, env = {}) {
  const { instantCode, challenge } = await (await call("/api/auth/send-code", { method: "POST", body: { email }, env })).json();
  const response = await call("/api/auth/verify", { method: "POST", body: { email, code: instantCode, challenge }, env });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("checkout uses only the requested tier and interval", async (t) => {
  const env = { CREEM_API_KEY: "test-key", CREEM_PRO_PRODUCT_ID: "pro-month", CREEM_MAX_PRODUCT_ID: "max-month" };
  const cookie = await login("billing@example.org", env);
  const products = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    products.push(JSON.parse(options.body).product_id);
    return Response.json({ checkout_url: "https://checkout.example.org/test" });
  });
  for (const tier of ["pro", "max"]) {
    const checkout = (interval) => call("/api/billing/checkout", { method: "POST", env, cookie, body: { tier, interval } });
    assert.equal((await checkout("year")).status, 503);
    assert.equal((await checkout("month")).status, 200);
    env[`CREEM_${tier.toUpperCase()}_YEARLY_PRODUCT_ID`] = `${tier}-year`;
    assert.equal((await checkout("year")).status, 200);
    const availability = await (await call("/api/billing/plans", { env })).json();
    assert.equal(availability[tier].year, true);
    if (tier === "pro") assert.equal(availability.max.year, false);
  }
  assert.deepEqual(products, ["pro-month", "pro-year", "max-month", "max-year"]);
});

test("pricing, refunds and privacy are public in both languages and linked from home and Studio", async () => {
  for (const [path, zh, en] of [["/pricing", "会员方案", "TalkCV plans"], ["/terms", "可接受使用政策", "Acceptable Use Policy"], ["/privacy", "站点访问与访客洞察", "Published sites and visitor insights"]]) {
    for (const [query, title] of [["", zh], ["?lang=en", en]]) {
      const res = await call(path + query);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes(title));
      if (path === "/pricing") for (const price of ["$0", "$20", "$49"]) assert.ok(html.includes(price));
    }
  }
  for (const path of ["/", "/create"]) {
    const html = await (await call(path)).text();
    for (const link of ["pricing", "terms", "privacy"]) assert.match(html, new RegExp(`href="/${link}[?"]`));
  }
});

const { default: profile } = await import("../data/profile.json", { with: { type: "json" } });
const publish = (slug, cookie, extra = {}, env) => call("/api/publish", { method: "POST", cookie, body: { slug, profile, ...extra }, env });

test("only the owning account can remove a site and immediately reuse the slot", async () => {
  const owner = await login("owner@example.org");
  const other = await login("other@example.org");
  assert.equal((await publish("owned-one", owner)).status, 200);
  assert.equal((await publish("owned-two", owner)).status, 200);
  assert.equal((await publish("owned-three", owner)).status, 403);
  const remove = (cookie) => call("/api/profiles/owned-one", { method: "DELETE", cookie });
  assert.equal((await remove()).status, 401);
  assert.equal((await remove(other)).status, 403);
  assert.deepEqual((await (await remove(owner)).json()).sites, ["owned-two"]);
  assert.equal((await call("/u/owned-one")).status, 404);
  assert.equal((await call("/api/profiles/owned-one")).status, 404);
  assert.equal((await remove(owner)).status, 404);
  assert.equal((await publish("owned-three", owner)).status, 200);
  const { user } = await (await call("/api/auth/me", { cookie: owner })).json();
  assert.equal(user.maxSites, 2);
  assert.deepEqual(user.sites, ["owned-two", "owned-three"]);
});

test("web generation retains supplied contacts and drops ungrounded AI contact details", async (t) => {
  const contacts = { email: "madeup@example.org", github: "https://github.com/invented", wechat: "alex_test",
    linkedin: "https://www.linkedin.com/in/alex-test", portfolio: "https://alex.test/work" };
  t.mock.method(globalThis, "fetch", async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ ...profile, basics: { ...profile.basics, ...contacts } }) } }],
  }));
  const response = await call("/api/generate", { method: "POST", body: {
    resumeText: `Alex builds tools. 微信号：${contacts.wechat} LinkedIn: ${contacts.linkedin} Portfolio: ${contacts.portfolio}`,
    apiKey: "unit-test", baseUrl: "https://provider.test/v1",
  } });
  assert.equal(response.status, 200);
  const generated = (await response.json()).profile;
  assert.equal(generated.basics.wechat, contacts.wechat);
  assert.equal(generated.basics.linkedin, contacts.linkedin);
  assert.equal(generated.basics.portfolio, contacts.portfolio);
  assert.equal(generated.basics.email, "");
  assert.equal(generated.basics.github, undefined);
  assert.equal((await publish("contact-test", undefined, { profile: generated })).status, 200);
  assert.deepEqual((await (await call("/api/profiles/contact-test")).json()).profile.basics, generated.basics);
});

test("locked sites protect HTML, profile and chat, isolate unlocks and revoke them on rotation", async (t) => {
  const cookie = await login("private@example.org");
  const slug = "private-test";
  const privacy = { noindex: true, protected: true, passcode: "B4test" };
  const save = (settings) => publish(slug, cookie, { privacy: settings });
  assert.equal((await save({ ...privacy, passcode: "x" })).status, 400);
  assert.equal((await save(privacy)).status, 200);
  assert.equal((await publish("private-second", cookie, { privacy })).status, 200);
  const path = `/api/profiles/${slug}`;
  const page = await call(`/u/${slug}`);
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  const html = await page.text();
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /此简历需要访问口令/);
  assert.doesNotMatch(html, /B4test|Alex Chen/);
  assert.doesNotMatch(await (await call("/sitemap.xml")).text(), /private-test/);
  const locked = await call(path);
  assert.equal(locked.status, 401);
  assert.deepEqual(await locked.json(), { locked: true });
  assert.equal((await call(path + "?edit=1")).status, 403);
  const owner = await (await call(path + "?edit=1", { cookie })).json();
  assert.deepEqual(owner.privacy, { noindex: true, protected: true });
  assert.doesNotMatch(JSON.stringify(owner), /B4test|"hash"|"salt"/);
  const chat = (access) => call("/api/chat", { method: "POST", cookie: access, env: { OPENAI_API_KEY: "test" },
    body: { profileSlug: slug, messages: [{ role: "user", content: "What is the role?" }] } });
  assert.equal((await chat()).status, 401);
  const unlock = (passcode) => call(path + "/unlock", { method: "POST", body: { passcode } });
  assert.equal((await unlock("wrong")).status, 403);
  const allowed = await unlock(privacy.passcode);
  assert.equal(allowed.status, 200);
  const access = allowed.headers.get("set-cookie").split(";")[0];
  assert.match(allowed.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await call(path, { cookie: access })).status, 200);
  assert.equal((await call("/api/profiles/private-second", { cookie: access })).status, 401);
  t.mock.method(globalThis, "fetch", async () => new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'));
  assert.match(await (await chat(access)).text(), /Hello/);
  assert.equal((await save({ protected: true })).status, 200);
  assert.equal((await call(path, { cookie: access })).status, 200);
  assert.equal((await save({ ...privacy, passcode: "change4" })).status, 200);
  assert.equal((await call(path, { cookie: access })).status, 401);
  assert.equal((await save({ protected: false, noindex: true })).status, 200);
  assert.equal((await call(path)).status, 200);
  assert.match(await (await call(`/u/${slug}`)).text(), /<meta name="robots" content="noindex, nofollow"/);
});

test("the print and poster QR encodes the canonical personal-site URL with an independent decoder", async () => {
  const { siteQrDataUrl } = await import("../lib/site-qr.mjs");
  const { PNG } = await import("pngjs");
  const { default: jsQR } = await import("jsqr");
  const png = PNG.sync.read(Buffer.from((await siteQrDataUrl("qr-test")).split(",")[1], "base64"));
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, "https://talkcv.renss.top/u/qr-test");
});

test("insights count HTML views and accepted questions, gate details by owner and tier, and clear on deletion", async (t) => {
  const env = { AUTH_SECRET: "insights-fixture", OPENAI_API_KEY: "fixture" };
  const owner = await login("analytics@example.org", env);
  const other = await login("outsider@example.org", env);
  const slug = "insight-test";
  const path = `/api/profiles/${slug}/insights`;
  assert.equal((await publish(slug, owner, {}, env)).status, 200);
  assert.equal((await call(`/u/${slug}`, { env })).status, 200);
  await call(`/u/${slug}`, { env, method: "HEAD" });
  await call(`/api/profiles/${slug}`, { env });
  t.mock.method(globalThis, "fetch", async () => new Response('data: {"choices":[{"delta":{"content":"Reply"}}]}\n\ndata: [DONE]\n\n'));
  for (const question of ["Can we discuss this JD? Email recruiter@company.test, call 13512345678. Requires TypeScript.", "How much team leadership experience?"]) {
    const chat = await call("/api/chat", { method: "POST", env, body: { profileSlug: slug, messages: [{ role: "user", content: question }] } });
    assert.equal(chat.status, 200);
    await chat.text();
  }
  assert.equal((await call(path, { env })).status, 401);
  assert.equal((await call(path, { cookie: other, env })).status, 403);
  assert.deepEqual(await (await call(path, { cookie: owner, env })).json(), { views: 1, today: 1, questions: 2 });
  for (const tier of ["pro", "max"]) {
    const code = `INSIGHT-${tier.toUpperCase()}`;
    await call("/api/billing/admin/codes", { method: "POST", env, headers: { authorization: `Bearer ${env.AUTH_SECRET}` }, body: { plan: tier, code, days: 1, maxUses: 1 } });
    const redeem = await call("/api/billing/redeem", { method: "POST", env, cookie: owner, body: { code } });
    assert.equal(redeem.status, 200);
    assert.equal((await redeem.json()).plan, tier);
    const stats = await (await call(path, { cookie: owner, env })).json();
    assert.equal(stats.recent.length, 2);
    assert.ok(Date.parse(stats.recent[0].at));
    assert.match(stats.recent[0].summary.en, /leadership/);
    assert.match(stats.recent[1].summary.zh, /岗位匹配/);
    assert.doesNotMatch(JSON.stringify(stats), /recruiter@|13512345678|company\.test/);
  }
  assert.equal((await call(`/api/profiles/${slug}`, { method: "DELETE", cookie: owner, env })).status, 200);
  assert.equal((await publish(slug, other, {}, env)).status, 200);
  assert.deepEqual(await (await call(path, { cookie: other, env })).json(), { views: 0, today: 0, questions: 0 });
});

test("the contact schema supports empty fields and recognizes only the supplied contact links", async () => {
  const { normalizeContacts } = await import("../lib/contacts.mjs");
  const { normalizeProfile, validateProfile } = await import("../scripts/generate.mjs");
  const contact = { email: "", linkedin: "linkedin.com/in/candidate", wechat: "my_wechat", portfolio: "https://my.test/portfolio" };
  const source = "微信号:my_wechat LinkedIn: linkedin.com/in/candidate，博客：https://my.test/portfolio";
  const value = normalizeContacts(contact, source);
  const cli = normalizeProfile({ ...profile, basics: { ...profile.basics, ...contact } }, { theme: profile.theme, siteUrl: profile.siteUrl, resumeText: source });
  assert.equal(cli.basics.portfolio, contact.portfolio);
  assert.equal(cli.basics.wechat, contact.wechat);
  assert.equal(cli.basics.github, undefined);
  assert.equal(cli.basics.email, "");
  assert.deepEqual(validateProfile(cli), []);
  assert.equal(value.linkedin, "https://linkedin.com/in/candidate");
  assert.equal(value.wechat, "my_wechat");
  assert.equal(value.portfolio, contact.portfolio);
  assert.deepEqual(validateProfile({ ...profile, basics: { ...profile.basics, ...value } }), []);
  const absent = normalizeContacts({ ...contact, linkedin: "https://linkedin.com/in/another" }, "No contact details.");
  assert.deepEqual(JSON.parse(JSON.stringify(absent)), { email: "" });
});

test("existing profile records without privacy fields remain public", async () => {
  const values = new Map([["profile:old-site", JSON.stringify(profile)]]);
  const env = { PROFILES_KV: { get: async (key) => values.get(key) ?? null } };
  const response = await call("/api/profiles/old-site", { env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).profile.basics.name.en, profile.basics.name.en);
  const signIn = await call("/api/auth/send-code", { env, method: "POST", body: { email: "verify@example.test" } });
  assert.equal(signIn.status, 503);
  assert.equal((await signIn.json()).instantCode, undefined);
});
