import { hmacHex, parseCookies, timingSafeEqual } from "./auth";
import { normalizeSlug } from "../lib/schema";
import { loadStoredRecord, type PublishEnv } from "./publish";

export interface PasscodeHash { salt: string; hash: string }

export function validPasscode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{4,8}$/.test(value);
}

export async function hashPasscode(value: string, salt: string = crypto.randomUUID()): Promise<PasscodeHash> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  const hash = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
  return { salt, hash };
}

export async function siteUnlocked(request: Request, slug: string, passcode?: PasscodeHash) {
  if (!passcode) return true;
  const token = parseCookies(request)[`talkcv_access_${slug}`] || "";
  const [expires, signature] = token.split(".");
  if (!signature || !Number.isSafeInteger(Number(expires)) || Number(expires) <= Date.now()) return false;
  return timingSafeEqual(signature, await hmacHex(passcode.hash, `site-access:${slug}:${expires}`));
}

const attempts = new Map<string, { count: number; until: number }>();

export async function unlockSite(request: Request, rawSlug: string, env: PublishEnv) {
  const slug = normalizeSlug(rawSlug);
  const record = await loadStoredRecord(slug, env);
  const headers = new Headers({ "cache-control": "private, no-store" });
  if (!record) return Response.json({ error: "Site not found." }, { status: 404, headers });
  if (!record.passcode) return Response.json({ ok: true }, { headers });
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${slug}:${ip}`;
  const bucket = attempts.get(key) ?? { count: 0, until: now + 600000 };
  if (bucket.count >= 5) return Response.json({ error: "Too many attempts." }, { status: 429, headers });
  bucket.count++;
  attempts.set(key, bucket);
  const body = await request.json().catch(() => null);
  if (!validPasscode(body?.passcode) || !timingSafeEqual((await hashPasscode(body.passcode, record.passcode.salt)).hash, record.passcode.hash)) {
    return Response.json({ error: "Incorrect passcode." }, { status: 403, headers });
  }
  attempts.delete(key);
  const expires = Date.now() + 86400000;
  const signature = await hmacHex(record.passcode.hash, `site-access:${slug}:${expires}`);
  headers.set("set-cookie", `talkcv_access_${slug}=${expires}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${request.url.startsWith("https://") ? "; Secure" : ""}`);
  return Response.json({ ok: true }, { headers });
}
