import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";

function call(path, { method = "GET", body, cookie, env = {}, headers = {}, ctx } = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, ...env }, ctx);
}

function fixtureKv(store) {
  return {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
    listPrefix: async (prefix) => Array.from(store).filter(([k]) => k.startsWith(prefix))
      .map(([key, value]) => ({ key, value, updatedAt: "2026-11-24T00:00:00.000Z" })),
  };
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

test("the bilingual login page renders an email form and opts out of indexing", async () => {
  for (const [query, title] of [["", "登录 TalkCV"], ["?lang=en&next=/admin", "Sign in to TalkCV"]]) {
    const res = await call("/login" + query);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(title));
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(html, /<input[^>]*type="email"/);
  }
});

test("login redirects accept only local paths and preserve their queries and fragments", async () => {
  const { safeLoginNext } = await import("../lib/login.ts");
  for (const path of ["/create", "/admin", "/pricing?lang=en#plans", "/u/my-site"]) assert.equal(safeLoginNext(path), path);
  for (const value of [undefined, "", ["//evil.test"], "https://evil.test", "//evil.test", "/\\evil.test", "/.//evil.test",
    "/\t/evil.test", "/\t/["]) assert.equal(safeLoginNext(value), "/create");
});

test("anonymous visitors can open Studio and demo chat from home; only product headers offer account sign-in", async () => {
  const home = await call("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /href="\/create\?lang=en"/);
  assert.match(html, /class="af-ai-fab"/);
  assert.match(html, /href="\/login\?next=\/create&amp;lang=en"/);
  for (const path of ["/pricing", "/terms", "/privacy"]) {
    const product = await (await call(path)).text();
    assert.match(product, /href="\/login\?next=\/create"/);
  }
  assert.equal((await publish("menu-personal", undefined)).status, 200);
  const personal = await call("/u/menu-personal");
  assert.equal(personal.status, 200);
  assert.doesNotMatch(await personal.text(), /href="\/login\?next=|af-account-trigger/);
});

test("the Studio tour has a manual entry and four distinct targets before a résumé is generated", async () => {
  const studio = await (await call("/create")).text();
  assert.match(studio, /aria-label="新手引导 \/ Quick guide"/);
  for (const id of ["upload", "preview", "privacy", "publish"]) assert.equal(studio.split(`data-tour="${id}"`).length - 1, 1);
  assert.doesNotMatch(studio, /<dialog[^>]*class="af-tour"/);
});

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

test("referral program grants credit-capped Pro trial to both sides only after first publish", async () => {
  const env = {};
  const inviterCookie = await login("inviter@example.org", env);
  const inviterBefore = (await (await call("/api/auth/me", { cookie: inviterCookie, env })).json()).user;
  assert.match(inviterBefore.referral.code, /^[A-Z0-9]{6}$/);
  assert.equal(inviterBefore.isPro, false);
  assert.equal(inviterBefore.dailyLimit, 3);

  // Invitee signs up with inviter's referral code — no reward yet before publishing
  const { instantCode, challenge } = await (
    await call("/api/auth/send-code", { method: "POST", body: { email: "invitee@example.org" }, env })
  ).json();
  const verifyRes = await call("/api/auth/verify", {
    method: "POST",
    body: { email: "invitee@example.org", code: instantCode, challenge, referralCode: inviterBefore.referral.code },
    env,
  });
  assert.equal(verifyRes.status, 200);
  const inviteeCookie = verifyRes.headers.get("set-cookie").split(";")[0];
  const verifyData = await verifyRes.json();
  assert.equal(verifyData.user.isPro, false);
  assert.equal(verifyData.user.dailyLimit, 3);
  assert.equal(verifyData.user.referral.hasPendingReferrer, true);

  // Invitee publishes first site -> unlocks credit-capped Pro trial for both sides
  const firstPub = await publish("invitee-first", inviteeCookie, {}, env);
  assert.equal(firstPub.status, 200);
  const firstPubJson = await firstPub.json();
  assert.deepEqual(firstPubJson.referralReward, { generates: 3, edits: 10, trialDays: 3, inviterRewarded: true });

  // Published profile exposes ownerRefCode for viral footer link
  const profileJson = await (await call("/api/profiles/invitee-first", { env })).json();
  assert.equal(profileJson.ownerRefCode, verifyData.user.referral.code);

  // Invitee gets 3-day Pro trial with 3+3=6 generates, 10 AI edits, and NO AI avatar generation
  const inviteeAfter = (await (await call("/api/auth/me", { cookie: inviteeCookie, env })).json()).user;
  assert.equal(inviteeAfter.isPro, true);
  assert.equal(inviteeAfter.isTrial, true);
  assert.equal(inviteeAfter.dailyLimit, 6);
  assert.equal(inviteeAfter.editDailyLimit, 10);
  assert.equal(inviteeAfter.referral.hasPendingReferrer, false);
  const avatarAttempt = await call("/api/avatar", {
    method: "POST",
    cookie: inviteeCookie,
    body: { prompt: "minimalist portrait" },
    env,
  });
  assert.equal(avatarAttempt.status, 403);

  // Inviter gets 7-day Pro trial with 3+5=8 generates, 15 AI edits, invitedCount=1
  const inviterAfter = (await (await call("/api/auth/me", { cookie: inviterCookie, env })).json()).user;
  assert.equal(inviterAfter.isPro, true);
  assert.equal(inviterAfter.isTrial, true);
  assert.equal(inviterAfter.dailyLimit, 8);
  assert.equal(inviterAfter.editDailyLimit, 15);
  assert.equal(inviterAfter.referral.invitedCount, 1);

  // Second publish by the same invitee must NOT grant duplicate rewards
  const secondPub = await publish("invitee-second", inviteeCookie, {}, env);
  assert.equal(secondPub.status, 200);
  assert.equal((await secondPub.json()).referralReward, undefined);
  const inviterAfterSecond = (await (await call("/api/auth/me", { cookie: inviterCookie, env })).json()).user;
  assert.equal(inviterAfterSecond.referral.invitedCount, 1);
  assert.equal(inviterAfterSecond.dailyLimit, 8);
});

test("referral guards block existing users, serialize concurrent friends, deduct bonus edits, and align trial expiry", async (t) => {
  const env = { DEEPSEEK_API_KEY: "test-key", OPENAI_API_KEY: "test-key" };
  const inviterCookie = await login("race-inviter@example.org", env);
  const inviterCode = (await (await call("/api/auth/me", { cookie: inviterCookie, env })).json()).user.referral.code;

  // 1) Existing user who already published a site cannot bind a referral code or qualify on update
  const { instantCode: vCode, challenge: vChallenge } = await (
    await call("/api/auth/send-code", { method: "POST", body: { email: "veteran@example.org" }, env })
  ).json();
  const veteranFirstLogin = await call("/api/auth/verify", {
    method: "POST",
    body: { email: "veteran@example.org", code: vCode, challenge: vChallenge },
    env,
  });
  assert.equal(veteranFirstLogin.status, 200);
  const veteranCookie = veteranFirstLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await publish("veteran-site", veteranCookie, {}, env)).status, 200);
  const veteranRelogin = await call("/api/auth/verify", {
    method: "POST",
    body: { email: "veteran@example.org", code: vCode, challenge: vChallenge, referralCode: inviterCode },
    env,
  });
  assert.equal(veteranRelogin.status, 200);
  const veteranReloginData = await veteranRelogin.json();
  assert.equal(veteranReloginData.user.referral.hasPendingReferrer, false);
  const veteranUpdate = await publish("veteran-site", veteranCookie, {}, env);
  assert.equal(veteranUpdate.status, 200);
  assert.equal((await veteranUpdate.json()).referralReward, undefined);

  // 2) Two friends publishing concurrently both credit the inviter without lost updates
  async function signupWithRef(email) {
    const { instantCode, challenge } = await (
      await call("/api/auth/send-code", { method: "POST", body: { email }, env })
    ).json();
    const res = await call("/api/auth/verify", {
      method: "POST",
      body: { email, code: instantCode, challenge, referralCode: inviterCode },
      env,
    });
    return res.headers.get("set-cookie").split(";")[0];
  }
  const friend1 = await signupWithRef("friend-one@example.org");
  const friend2 = await signupWithRef("friend-two@example.org");
  const [pub1, pub2] = await Promise.all([
    call("/api/publish", {
      method: "POST",
      cookie: friend1,
      env,
      headers: { "x-forwarded-for": "10.0.1.1" },
      body: { slug: "friend-one-site", profile },
    }),
    call("/api/publish", {
      method: "POST",
      cookie: friend2,
      env,
      headers: { "x-forwarded-for": "10.0.1.2" },
      body: { slug: "friend-two-site", profile },
    }),
  ]);
  assert.equal(pub1.status, 200);
  assert.equal(pub2.status, 200);
  const inviterAfterRace = (await (await call("/api/auth/me", { cookie: inviterCookie, env })).json()).user;
  assert.equal(inviterAfterRace.referral.invitedCount, 2);
  assert.equal(inviterAfterRace.referral.bonusGenerates, 10);
  assert.equal(inviterAfterRace.referral.bonusEdits, 30);

  // 3) Trial AI edit actually deducts bonusEdits balance (10 -> 9), never re-granting across months
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify({ summary: "Refined", profile }) } }],
    }),
  );
  const editRes = await call("/api/edit", {
    method: "POST",
    cookie: friend1,
    env,
    body: { profile, instruction: "Tighten headline" },
  });
  assert.equal(editRes.status, 200);
  const friend1AfterEdit = (await (await call("/api/auth/me", { cookie: friend1, env })).json()).user;
  assert.equal(friend1AfterEdit.referral.bonusEdits, 9);
  assert.equal(friend1AfterEdit.editDailyLimit, 9);

  // 4) Legacy site without stored ownerRefCode still resolves ownerRefCode & expired trial site returns 410 in chat
  const values = new Map([
    [
      "profile:legacy-trial",
      JSON.stringify({
        profile,
        ownerEmail: "friend-one@example.org",
        createdAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-02-01T00:00:00.000Z",
      }),
    ],
    [
      "profile:legacy-active",
      JSON.stringify({
        profile,
        ownerEmail: "friend-one@example.org",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ],
  ]);
  const kvEnv = {
    ...env,
    PROFILES_KV: {
      get: async (k) => values.get(k) ?? null,
      put: async (k, v) => { values.set(k, v); },
    },
  };
  const legacyRes = await (await call("/api/profiles/legacy-active", { env: kvEnv })).json();
  assert.match(legacyRes.ownerRefCode, /^[A-Z0-9]{6}$/);
  assert.equal((await call("/api/profiles/legacy-trial", { env: kvEnv })).status, 410);
  const expiredChat = await call("/api/chat", {
    method: "POST",
    env: kvEnv,
    body: { profileSlug: "legacy-trial", messages: [{ role: "user", content: "Hi" }] },
  });
  assert.equal(expiredChat.status, 410);
});

test("admin API enforces ADMIN_EMAILS session auth, returns overview stats, and mints redeem codes", async () => {
  const store = new Map([
    [
      "profile:demo-user-site",
      JSON.stringify({
        profile,
        ownerEmail: "member@example.org",
        createdAt: "2026-11-20T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ],
    ["user_sites:member@example.org", JSON.stringify(["demo-user-site"])],
    [
      "ref_user:member@example.org",
      JSON.stringify({ code: "MEM123", invitedCount: 1, bonusGenerates: 5, bonusEdits: 15 }),
    ],
    ["insights:demo-user-site", JSON.stringify({ views: 12, questions: 4 })],
  ]);
  const kv = fixtureKv(store);
  const unverifiedEnv = { ADMIN_EMAILS: "boss@example.org", AUTH_SECRET: "admin-test-secret", PROFILES_KV: kv };
  const adminEnv = { ...unverifiedEnv, RESEND_API_KEY: "re_test_verified" };

  // Without verified email delivery configured -> 503
  assert.equal((await call("/api/admin/overview", { env: unverifiedEnv })).status, 503);

  // Unauthenticated -> 401
  assert.equal((await call("/api/admin/overview", { env: adminEnv })).status, 401);

  // Regular user -> 403
  const regularCookie = await login("member@example.org", { AUTH_SECRET: "admin-test-secret" });
  assert.equal((await call("/api/admin/overview", { cookie: regularCookie, env: adminEnv })).status, 403);
  assert.equal((await call("/api/admin/codes", { method: "POST", cookie: regularCookie, env: adminEnv, body: { plan: "pro" } })).status, 403);

  // Admin user -> 200 overview + mint code
  const adminCookie = await login("boss@example.org", { AUTH_SECRET: "admin-test-secret" });
  const createRes = await call("/api/admin/codes", {
    method: "POST",
    cookie: adminCookie,
    env: adminEnv,
    body: { plan: "max", days: 30, maxUses: 2, note: "admin-ui-test" },
  });
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(created.codes.length, 1);

  const overviewRes = await call("/api/admin/overview", { cookie: adminCookie, env: adminEnv });
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.equal(overview.adminEmail, "boss@example.org");
  assert.equal(overview.summary.totalSites, 1);
  assert.equal(overview.summary.totalViews, 12);
  assert.equal(overview.summary.totalQuestions, 4);
  assert.equal(overview.users.some((u) => u.email === "member@example.org"), true);
  assert.equal(overview.codes.some((c) => c.code === created.codes[0].code && c.plan === "max"), true);

  // /admin page renders with noindex meta
  const pageHtml = await (await call("/admin", { env: adminEnv })).text();
  assert.match(pageHtml, /noindex/);
});

test("recruiter leads enforce site access, limit each sender, notify after saving and redact Free previews", async (t) => {
  const ownerEmail = "leads-owner@example.org";
  const auth = { AUTH_SECRET: "lead-tests" };
  const owner = await login(ownerEmail, auth);
  const other = await login("leads-other@example.org", auth);
  const store = new Map();
  const env = { ...auth, PROFILES_KV: fixtureKv(store), ADMIN_EMAILS: ownerEmail, ADMIN_ALLOW_DEV_AUTH: "1" };
  const slug = "recruiter-site", path = `/api/profiles/${slug}`;
  const body = { name: "Mia", company: "Sample Studio", contact: "mia@sample.test", note: "Platform engineer" };
  const post = (overrides = {}) => call(path + "/leads", { env, method: "POST", body, ...overrides });
  assert.equal((await post()).status, 404);
  assert.equal((await publish(slug, owner, { privacy: { protected: true, passcode: "Test7" } }, env)).status, 200);
  assert.equal((await post()).status, 401);
  assert.equal((await post({ cookie: owner })).status, 401);
  const unlock = await call(path + "/unlock", { env, method: "POST", body: { passcode: "Test7" } });
  const access = unlock.headers.get("set-cookie").split(";")[0];
  for (const invalid of [{}, { contact: "bad@email" }, { contact: "hi there" }, { ...body, note: "x".repeat(1001) }]) {
    assert.equal((await post({ cookie: access, body: invalid })).status, 400);
  }
  let notification, mail;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.ok(store.has("leads:" + slug));
    mail = JSON.parse(opts.body);
    return Response.json({ id: "test-mail" });
  });
  const sent = await post({ env: { ...env, RESEND_API_KEY: "fixture" }, cookie: access,
    ctx: { waitUntil(task) { notification = task; } } });
  assert.equal(sent.status, 201);
  assert.ok(notification instanceof Promise);
  await notification;
  assert.deepEqual(mail.to, [ownerEmail]);
  assert.match(mail.text, /Mia · Sample Studio/);
  assert.match(mail.text, /\/create\?handle=recruiter-site/);
  assert.doesNotMatch(mail.text, /mia@sample|Platform engineer/);
  assert.equal((await call(path + "/leads", { env, cookie: access })).status, 401);
  assert.equal((await call(path + "/leads", { env, cookie: other })).status, 403);
  const get = async () => (await call(path + "/leads", { env, cookie: owner })).json();
  const free = await get();
  assert.deepEqual(free, { count: 1, locked: true, preview: [{ company: body.company, createdAt: free.preview[0].createdAt }] });
  assert.ok(Date.parse(free.preview[0].createdAt));
  const ref = JSON.parse(store.get(`ref_user:${ownerEmail}`));
  for (const tier of ["trial", "pro", "max"]) {
    if (tier === "trial") store.set(`ref_user:${ownerEmail}`, JSON.stringify({ ...ref, trialExpiresAt: "2099-01-01" }));
    else {
      store.set(`ref_user:${ownerEmail}`, JSON.stringify(ref));
      store.set(`plan:${ownerEmail}`, JSON.stringify({ plan: tier }));
    }
    const view = await get();
    assert.equal(view.locked, false);
    assert.deepEqual(view.leads[0], { ...body, id: view.leads[0].id, createdAt: free.preview[0].createdAt });
    assert.ok(view.leads[0].id);
  }
  const sameSender = await Promise.all(Array.from({ length: 3 }, () => post({ cookie: access })));
  assert.deepEqual(sameSender.map((r) => r.status).sort(), [201, 201, 429]);
  assert.equal((await publish("recruiter-second", owner, {}, env)).status, 200);
  assert.equal((await call("/api/profiles/recruiter-second/leads", { env, method: "POST", body })).status, 201);
  const batch = await Promise.all(Array.from({ length: 49 }, (_, i) => post({ cookie: access,
    headers: { "cf-connecting-ip": `192.0.2.${i + 1}` }, body: { contact: `wechat_${i}` } })));
  assert.ok(batch.every((r) => r.status === 201));
  const latest = await get();
  assert.equal(latest.count, 52);
  assert.equal(new Set(latest.leads.map((l) => l.id)).size, 50);
  assert.equal(latest.leads[0].contact, "wechat_48");
  const admin = () => call("/api/admin/overview", { cookie: owner, env }).then((r) => r.json());
  assert.equal((await admin()).summary.totalLeads, 53);
  const row = JSON.parse(store.get("profile:" + slug));
  store.set("profile:" + slug, JSON.stringify({ ...row, expiresAt: "2020-01-01" }));
  store.delete(`plan:${ownerEmail}`);
  assert.equal((await post({ cookie: access })).status, 410);
  assert.equal((await call(path, { method: "DELETE", env, cookie: owner })).status, 200);
  assert.equal(store.has("leads:" + slug), false);
  assert.equal((await admin()).summary.totalLeads, 1);
  assert.equal((await publish(slug, other, {}, env)).status, 200);
  assert.deepEqual(await (await call(path + "/leads", { env, cookie: other })).json(), { locked: true, count: 0, preview: [] });
});

test("the private AI brief is owner-editable, isolated per site and used only by the server chat prompt", async (t) => {
  const env = { AUTH_SECRET: "brief-fixture", OPENAI_API_KEY: "model-fixture" };
  const owner = await login("brief-owner@example.org", env);
  const other = await login("brief-reader@example.org", env);
  const slug = "private-brief", path = `/api/profiles/${slug}`;
  const aiBrief = { expectedSalary: "BriefSalary", availability: "After notice", workMode: "Hybrid preference",
    notes: "Custom candidate note", redLines: "Undisclosed acquisition" };
  assert.equal((await publish(slug, undefined, { aiBrief }, env)).status, 401);
  assert.equal((await publish(slug, owner, { profile: { ...profile, aiBrief } }, env)).status, 400);
  assert.equal((await publish(slug, owner, { aiBrief: { notes: "x".repeat(1001) } }, env)).status, 400);
  assert.equal((await publish(slug, owner, { aiBrief, profile: { ...profile, stylePrompt: "文".repeat(87_000) } }, env)).status, 413);
  assert.equal((await publish(slug, owner, { padding: "x".repeat(260_001) }, env)).status, 413);
  assert.equal((await publish(slug, owner, { aiBrief }, env)).status, 200);
  assert.equal((await publish(slug, owner, {}, env)).status, 200);
  for (const cookie of [undefined, other, owner]) {
    const res = await call(path, { cookie, env });
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /aiBrief|BriefSalary|Undisclosed acquisition/);
  }
  for (const cookie of [undefined, other]) assert.equal((await call(path + "?edit=1", { cookie, env })).status, 403);
  const edit = () => call(path + "?edit=1", { cookie: owner, env }).then((r) => r.json());
  assert.deepEqual((await edit()).aiBrief, aiBrief);
  assert.equal((await publish(slug, other, { aiBrief: {} }, env)).status, 403);
  const prompts = [];
  t.mock.method(globalThis, "fetch", async (_url, opts) => {
    prompts.push(JSON.parse(opts.body).messages);
    return new Response('data: {"choices":[{"delta":{"content":"Please contact the candidate."}}]}\n\ndata: [DONE]\n\n');
  });
  for (const profileSlug of [slug, undefined]) {
    const res = await call("/api/chat", { env, method: "POST", headers: { "cf-connecting-ip": "brief-test" },
      body: { profileSlug, aiBrief: { notes: "visitor-supplied" }, quote: "visitor quote", messages: [{ role: "user", content: "When can you start?" }] } });
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /BriefSalary|Undisclosed acquisition/);
  }
  assert.equal(prompts[0][0].role, "system");
  for (const value of Object.values(aiBrief)) assert.ok(prompts[0][0].content.includes(value));
  assert.match(prompts[0][0].content, /politely decline.*leave their contact/i);
  assert.doesNotMatch(prompts[0][0].content, /visitor-supplied|visitor quote/);
  assert.doesNotMatch(prompts[1][0].content, /BriefSalary|Undisclosed acquisition/);
  assert.equal((await publish(slug, owner, { aiBrief: {} }, env)).status, 200);
  assert.equal((await edit()).aiBrief, undefined);
});

test("inline citations use actual project slugs and zero-based experience indexes, including streamed answers", async (t) => {
  const { parseCitations } = await import("../lib/citations.ts");
  const project = profile.projects[0], experience = profile.experiences[0];
  const tag = `[[cite:project:${project.slug}]]`;
  const first = { kind: "project", id: project.slug, title: project.title };
  const second = { kind: "exp", id: "0", title: experience.company };
  assert.deepEqual(parseCitations("See " + tag + " and [[cite:exp:0]].", profile), ["See ", first, " and ", second, "."]);
  for (const invalid of ["project:absent", "exp:-1", "exp:00", "exp:1.0", "exp:999", "url:https://unrelated.test"]) {
    assert.deepEqual(parseCitations("ok[[cite:" + invalid + "]]", profile), ["ok"]);
  }
  assert.deepEqual(parseCitations("ok[[cite:project:part", profile), ["ok"]);
  t.mock.method(globalThis, "fetch", async (_url, opts) => {
    const system = JSON.parse(opts.body).messages[0].content;
    assert.ok(system.includes(tag));
    assert.ok(system.includes("[[cite:exp:0]]"));
    const chunks = ["[[ci", `te:project:${project.slug}]]`, " [[cite:exp:0]]"];
    return new Response(chunks.map((content) => "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\n").join("") + "data: [DONE]\n\n");
  });
  const chat = await call("/api/chat", { method: "POST", env: { OPENAI_API_KEY: "fixture" }, headers: { "cf-connecting-ip": "cite-test" },
    body: { messages: [{ role: "user", content: "What did the candidate build?" }] } });
  const sse = await chat.text();
  assert.equal(chat.status, 200);
  const text = sse.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).delta ?? "").join("");
  assert.deepEqual(parseCitations(text, profile), [first, " ", second]);
});

test("a résumé with no projects does not acquire citable sample projects", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...profile, projects: [] }) } }] }));
  const res = await call("/api/generate", { method: "POST", headers: { "cf-connecting-ip": "empty-projects" },
    body: { resumeText: "Employment history only, without any project entries.", apiKey: "fixture" } });
  assert.equal(res.status, 200);
  const generated = (await res.json()).profile;
  assert.deepEqual(generated.projects, []);
  const { validateProfile } = await import("../scripts/generate.mjs");
  assert.deepEqual(validateProfile(generated), []);
});

test("JD outreach checks login, model permissions, payload, factual output and concurrent hosted limits", async (t) => {
  const env = { AUTH_SECRET: "outreach-tests", OPENAI_API_KEY: "hosted-fixture" };
  const cookie = await login("outreach@example.org", env);
  const body = { profile, jdText: "Seeking someone to build backend systems.", style: "boss", lang: "zh", hostedModelId: "gpt-4o-mini" };
  const byok = { providerMode: "byok", apiKey: "byok-fixture", baseUrl: "https://upstream.test/v1", model: "custom-model" };
  const post = (changes = {}, options = {}) => call("/api/outreach", { method: "POST", env, cookie, body: { ...body, ...changes }, ...options });
  assert.equal((await call("/api/outreach")).status, 405);
  for (const config of [{}, byok]) assert.equal((await post(config, { cookie: undefined })).status, 401);
  for (const invalid of [{ profile: {} }, { profile: { ...profile, projects: [null] } }, { jdText: " " }, { jdText: "x".repeat(8001) },
    { lang: "de" }, { style: "other" }, { providerMode: "invalid" }]) assert.equal((await post(invalid)).status, 400);
  assert.equal((await post({ hostedModelId: "gpt-4o" })).status, 403);
  assert.equal((await post({ providerMode: "byok" })).status, 401);
  const output = { matches: ["Backend work", "Project delivery", "Systems design"], improvements: ["Clarify team scope"], body: "I would like to discuss the role." };
  const calls = [];
  let reply = output;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls.push({ url, auth: opts.headers.authorization, ...JSON.parse(opts.body) });
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  });
  const first = await post({ ...byok, style: "email", lang: "en",
    profile: { ...profile, aiBrief: { notes: "private-sentinel" }, basics: { ...profile.basics, avatar: "avatar-sentinel" } } });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), output);
  assert.equal(calls[0].url, "https://upstream.test/v1/chat/completions");
  assert.equal(calls[0].model, byok.model);
  assert.equal(calls[0].auth, "Bearer byok-fixture");
  assert.match(calls[0].messages[0].content, /English.*formal application email/);
  assert.ok(calls[0].messages[1].content.includes(body.jdText));
  assert.ok(calls[0].messages[1].content.includes(profile.projects[0].title.en));
  assert.doesNotMatch(calls[0].messages[1].content, /avatar-sentinel|private-sentinel/);
  reply = { ...output, matches: ["one"] };
  assert.equal((await post(byok)).status, 502);
  reply = { ...output, body: "I improved conversion by 98765%." };
  assert.equal((await post(byok)).status, 502);
  reply = output;
  const attempts = await Promise.all(Array.from({ length: 8 }, () => post()));
  assert.equal(attempts.filter((res) => res.status === 200).length, 6);
  assert.equal(attempts.filter((res) => res.status === 429).length, 2);
  assert.match(calls.at(-1).messages[0].content, /Chinese.*BOSS/);
  assert.equal(calls.at(-1).auth, "Bearer hosted-fixture");
  assert.equal((await post(byok)).status, 200);
});
