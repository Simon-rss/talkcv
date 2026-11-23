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
  assert.doesNotMatch(raw, /Ren Sishuo|renss\.top|rss1549596771|Simon-rss|evose|tiwork|PRD-50|PRD-56/i);
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
});
