/**
 * Server-side A4 PDF renderer using headless Chromium (--print-to-pdf).
 * Accepts ONLY structured ResumePdfPlan JSON (never raw untrusted HTML), renders via shared
 * lib/pdf-resume-templates.mjs, disables JS in Chromium, and returns a real downloadable PDF.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { renderResumePdfHtml, sanitizeResumePdfPlan } from "../lib/pdf-resume-templates.mjs";
import { publishedSiteUrl, siteQrDataUrl } from "../lib/site-qr.mjs";

const execFileAsync = promisify(execFile);

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

function findChromiumBinary() {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export async function handleRenderPdfResumeNodeRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const chromium = findChromiumBinary();
  if (!chromium) {
    sendJson(res, 501, { error: "Server PDF renderer is unavailable; falling back to browser print." });
    return;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > 1_200_000) {
      sendJson(res, 413, { error: "Request body too large." });
      return;
    }
    chunks.push(buf);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  if (!body || typeof body !== "object" || !body.plan || typeof body.plan !== "object") {
    sendJson(res, 400, { error: "Missing plan payload." });
    return;
  }

  const plan = sanitizeResumePdfPlan(body.plan);
  const rawSlug = typeof body.slug === "string" ? body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) : "";
  const qrDataUrl = plan.showQr && rawSlug ? await siteQrDataUrl(rawSlug).catch(() => "") : "";
  const siteUrl = rawSlug ? publishedSiteUrl(rawSlug) : "";
  const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl : "";

  const html = renderResumePdfHtml(plan, { qrDataUrl, siteUrl, avatarUrl });
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "talkcv-pdf-"));
  const htmlPath = path.join(tmpDir, `${randomUUID()}.html`);
  const pdfPath = path.join(tmpDir, `${randomUUID()}.pdf`);

  try {
    await writeFile(htmlPath, html, "utf8");
    const args = [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-javascript",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ];
    await execFileAsync(chromium, args, { timeout: 25_000, maxBuffer: 4 * 1024 * 1024 });
    const pdfBytes = await readFile(pdfPath);
    if (!pdfBytes || pdfBytes.length < 100 || pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Invalid PDF output");
    }

    const safeFileName = (plan.name || "TalkCV-Resume").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-").slice(0, 48) || "TalkCV-Resume";
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="TalkCV-Resume.pdf"; filename*=UTF-8''${encodeURIComponent(`${safeFileName}-Resume.pdf`)}`,
      "cache-control": "no-store",
      "content-length": String(pdfBytes.length),
    });
    res.end(pdfBytes);
  } catch (err) {
    console.error("[talkcv] PDF render failed:", err);
    sendJson(res, 500, { error: "Failed to render PDF." });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
