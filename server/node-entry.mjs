/**
 * TalkCV Self-Hosted Node.js + PostgreSQL Server
 * Serves static assets from dist/client and runs the built App Router + API handler
 * backed by strongly consistent PostgreSQL tables (no KV propagation lag).
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import worker from "../dist/server/index.js";
import { handleParseResumeNodeRequest } from "./parse-resume.mjs";

const PORT = Number(process.env.PORT || 3100);
const CLIENT_DIR = path.resolve(import.meta.dirname, "..", "dist", "client");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function createPostgresKvAdapter() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn("[talkcv] DATABASE_URL not set; running with in-memory storage.");
    return undefined;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talkcv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talkcv_sites (
      slug TEXT PRIMARY KEY,
      owner_email TEXT,
      theme TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );
  `);
  console.log("[talkcv] Connected to PostgreSQL and ensured schema.");

  function storeFor(db) {
    return {
      async get(key) {
        const res = await db.query("SELECT value FROM talkcv_store WHERE key = $1", [key]);
        return res.rows[0]?.value ?? null;
      },
      async put(key, value) {
        await db.query(
          `INSERT INTO talkcv_store (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, value],
        );
        if (key.startsWith("profile:")) {
          const record = JSON.parse(value);
          await db.query(
            `INSERT INTO talkcv_sites (slug, owner_email, theme, expires_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (slug) DO UPDATE SET owner_email = EXCLUDED.owner_email,
               theme = EXCLUDED.theme, expires_at = EXCLUDED.expires_at`,
            [key.slice(8), record.ownerEmail ?? null, record.profile?.theme ?? record.theme ?? "editorial", record.expiresAt ?? null],
          );
        }
      },
      async delete(key) {
        await db.query("DELETE FROM talkcv_store WHERE key = $1", [key]);
        if (key.startsWith("profile:")) {
          const slug = key.slice(8);
          await db.query("DELETE FROM talkcv_store WHERE starts_with(key, $1)", [`chat_usage:${slug}:`]);
          await db.query("DELETE FROM talkcv_sites WHERE slug = $1", [slug]);
        }
      },
      async listPrefix(prefix, limit = 500) {
        const res = await db.query(
          "SELECT key, value, updated_at FROM talkcv_store WHERE starts_with(key, $1) ORDER BY updated_at DESC LIMIT $2",
          [prefix, limit],
        );
        return res.rows.map((r) => ({
          key: r.key,
          value: r.value,
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
        }));
      },
    };
  }

  return {
    ...storeFor(pool),
    async withSiteWrite(slug, email, operation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (slug) await client.query("SELECT pg_advisory_xact_lock(1, hashtext($1))", [slug]);
        if (email) await client.query("SELECT pg_advisory_xact_lock(2, hashtext($1))", [email]);
        const result = await operation(storeFor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function tryServeStatic(reqPath, res) {
  if (!reqPath || reqPath === "/" || reqPath.includes("..")) return false;
  const rel = reqPath.replace(/^\/+/, "");
  const filePath = path.join(CLIENT_DIR, rel);
  if (!filePath.startsWith(CLIENT_DIR) || !existsSync(filePath)) return false;
  const stat = statSync(filePath);
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME_TYPES[ext] || "application/octet-stream",
    "content-length": String(stat.size),
    "cache-control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const pgKv = await createPostgresKvAdapter();

const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
  AUTH_SECRET: process.env.AUTH_SECRET,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  CREEM_API_KEY: process.env.CREEM_API_KEY,
  CREEM_WEBHOOK_SECRET: process.env.CREEM_WEBHOOK_SECRET,
  CREEM_PRO_PRODUCT_ID: process.env.CREEM_PRO_PRODUCT_ID,
  CREEM_PRO_YEARLY_PRODUCT_ID: process.env.CREEM_PRO_YEARLY_PRODUCT_ID,
  CREEM_MAX_PRODUCT_ID: process.env.CREEM_MAX_PRODUCT_ID,
  CREEM_MAX_YEARLY_PRODUCT_ID: process.env.CREEM_MAX_YEARLY_PRODUCT_ID,
  CREEM_API_BASE: process.env.CREEM_API_BASE,
  PROFILES_KV: pgKv,
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const server = createServer(async (req, res) => {
  try {
    const proto = (req.headers["x-forwarded-proto"] || "http").toString().split(",")[0].trim();
    const host = (req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).toString();
    const url = new URL(req.url || "/", `${proto}://${host}`);

    if ((req.method === "GET" || req.method === "HEAD") && tryServeStatic(url.pathname, res)) {
      return;
    }

    if (url.pathname === "/api/parse-resume") {
      await handleParseResumeNodeRequest(req, res);
      return;
    }

    const chunks = [];
    if (req.method !== "GET" && req.method !== "HEAD") {
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }

    const webReq = new Request(url.href, {
      method: req.method,
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });

    const webRes = await worker.fetch(webReq, env);

    const outHeaders = {};
    const setCookies = typeof webRes.headers.getSetCookie === "function" ? webRes.headers.getSetCookie() : [];
    webRes.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") outHeaders[key] = value;
    });
    if (setCookies.length > 0) outHeaders["set-cookie"] = setCookies;

    res.writeHead(webRes.status, outHeaders);
    if (!webRes.body || req.method === "HEAD") {
      res.end();
      return;
    }

    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("[talkcv] request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[talkcv] Listening on http://0.0.0.0:${PORT}`);
});
