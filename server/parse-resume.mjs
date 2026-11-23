import mammoth from "mammoth";
import { extractText } from "unpdf";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 14_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const rateBuckets = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

function cleanExtractedText(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export async function parseResumeBuffer(buffer, filename) {
  const ext = (filename || "").toLowerCase().split(".").pop() || "";

  if (ext === "pdf") {
    const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const cleaned = cleanExtractedText(Array.isArray(text) ? text.join("\n\n") : text);
    if (cleaned.length < 20) {
      return {
        ok: false,
        status: 422,
        code: "SCANNED_PDF",
        error:
          "This PDF appears to be an image-only scan with no selectable text. Please export a text-based PDF/DOCX or paste your resume text.",
      };
    }
    return { ok: true, text: cleaned, pages: totalPages, format: "pdf" };
  }

  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    const cleaned = cleanExtractedText(result.value);
    if (cleaned.length < 10) {
      return {
        ok: false,
        status: 422,
        code: "EMPTY_DOCX",
        error: "Could not extract readable text from this DOCX file.",
      };
    }
    return { ok: true, text: cleaned, format: "docx" };
  }

  if (ext === "doc") {
    return {
      ok: false,
      status: 415,
      code: "LEGACY_DOC",
      error: "Legacy .doc format is not supported directly. Please save as .docx or .pdf and upload again.",
    };
  }

  if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "json") {
    const cleaned = cleanExtractedText(buffer.toString("utf8"));
    return { ok: true, text: cleaned, format: ext };
  }

  return {
    ok: false,
    status: 415,
    code: "UNSUPPORTED_FORMAT",
    error: "Unsupported file format. Please upload .pdf, .docx, .md, .txt, or .json.",
  };
}

export async function handleParseResumeNodeRequest(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const ip =
    (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();

  if (!checkRateLimit(ip)) {
    return sendJson(res, 429, { error: "Too many uploads. Please wait a minute and try again." });
  }

  const rawName = (req.headers["x-filename"] || "resume.pdf").toString();
  let filename = "resume.pdf";
  try {
    filename = decodeURIComponent(rawName).slice(0, 180);
  } catch {
    filename = rawName.slice(0, 180);
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += buf.length;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        return sendJson(res, 413, { error: "File is too large (max 5 MB)." });
      }
      chunks.push(buf);
    }
  } catch {
    return sendJson(res, 400, { error: "Failed to read uploaded file." });
  }

  if (totalBytes === 0) {
    return sendJson(res, 400, { error: "Uploaded file is empty." });
  }

  try {
    const buffer = Buffer.concat(chunks);
    const parsed = await parseResumeBuffer(buffer, filename);
    if (!parsed.ok) {
      return sendJson(res, parsed.status || 422, { error: parsed.error, code: parsed.code });
    }
    return sendJson(res, 200, {
      ok: true,
      text: parsed.text,
      format: parsed.format,
      ...(parsed.pages ? { pages: parsed.pages } : {}),
      fileName: filename,
    });
  } catch (err) {
    console.error("[talkcv] parse-resume error:", err);
    return sendJson(res, 422, {
      error: "Could not parse this file. Please ensure it is a valid, unencrypted PDF or DOCX file.",
    });
  }
}
