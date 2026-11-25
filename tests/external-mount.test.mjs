import assert from "node:assert/strict";
import test from "node:test";

test("external-mounted /u/<slug> proxies upstream with x-talkcv-proxy header and records insights + chat questions", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `ext-mount-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const kv = new Map();
  const slug = "simon-renss";
  const record = {
    ownerEmail: "rss1549596771@163.com",
    createdAt: "2026-11-25T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    externalOrigin: "https://portfolio.renss.top",
    profile: {
      basics: {
        name: { en: "Ren Sishuo", zh: "任思硕" },
        role: { en: "AI Solutions Engineer", zh: "AI 解决方案工程师" },
        headline: { en: "I turn ambiguous AI ideas into deployable systems.", zh: "把模糊的 AI 想法，做成可交付的系统。" },
      },
      skills: ["FastAPI", "React", "Univer", "PostgreSQL"],
      projects: [{ title: { en: "TalkCV", zh: "TalkCV" } }],
    },
  };
  kv.set(`profile:${slug}`, JSON.stringify(record));

  const env = {
    PROFILES_KV: {
      async get(key) { return kv.get(key) ?? null; },
      async put(key, value) { kv.set(key, value); },
      async delete(key) { kv.delete(key); },
    },
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };

  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const reqUrl = typeof input === "string" ? input : input.url;
    const hdrs = new Headers(init?.headers);
    calls.push({ url: reqUrl, method: init?.method ?? "GET", proxy: hdrs.get("x-talkcv-proxy") });
    if (reqUrl.endsWith("/api/chat")) {
      return new Response("data: {\"delta\":\"ok\"}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    }
    return new Response("<!doctype html><html><body>Simon Portfolio</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  const bgTasks = [];
  const ctx = { waitUntil(p) { bgTasks.push(p); } };

  try {
    // 1. Page visit
    const pageRes = await worker.fetch(
      new Request(`https://mytalkcv.com/u/${slug}`, {
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      }),
      env,
      ctx,
    );
    assert.equal(pageRes.status, 200);
    assert.match(await pageRes.text(), /Simon Portfolio/);

    // 2. Chat question POST
    const chatRes = await worker.fetch(
      new Request(`https://mytalkcv.com/u/${slug}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "介绍一下 TalkCV 和 FastAPI 架构" }],
        }),
      }),
      env,
      ctx,
    );
    assert.equal(chatRes.status, 200);
    await Promise.all(bgTasks);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://portfolio.renss.top/u/simon-renss");
    assert.equal(calls[0].proxy, "1");
    assert.equal(calls[1].url, "https://portfolio.renss.top/u/simon-renss/api/chat");
    assert.equal(calls[1].proxy, "1");

    const insights = JSON.parse(kv.get(`insights:${slug}`) ?? "{}");
    assert.equal(insights.views, 1);
    assert.equal(insights.today, 1);
    assert.equal(insights.questions, 1);
    assert.equal(insights.recent.length, 1);
    assert.match(insights.recent[0].summary.zh, /TalkCV|FastAPI|架构/);
  } finally {
    globalThis.fetch = origFetch;
  }
});
