import type { PublishEnv } from "./publish";

export interface DailyTrafficBucket {
  date: string;
  pv: number;
  uv: number;
  hashes: string[];
  pages: Record<string, number>;
  referrers: Record<string, number>;
  devices: { mobile: number; desktop: number };
}

export interface TrafficSummary {
  todayPv: number;
  todayUv: number;
  last7dPv: number;
  last7dUv: number;
  totalPv: number;
  totalUv: number;
  daily: Array<{ date: string; pv: number; uv: number }>;
  pages: Array<{ path: string; pv: number }>;
  referrers: Array<{ source: string; pv: number }>;
  devices: { mobile: number; desktop: number };
}

const MAX_DAILY_HASHES = 5000;
const MAX_REFERRER_KEYS = 80;
const BOT_UA_RE =
  /bot|crawler|spider|slurp|mediapartners|facebookexternalhit|bingpreview|lighthouse|pagespeed|headless|phantom|playwright|puppeteer|curl\/|wget\/|python-requests|go-http-client|uptime|pingdom|datadog|statuscake|ahrefs|semrush|mj12bot|dotbot|bytespider|petalbot|yandexbot|baiduspider|sogou|360spider|gptbot|claudebot|oai-searchbot/i;
const MOBILE_UA_RE = /android|iphone|ipad|ipod|mobile|micromessenger|harmonyos/i;

const memTraffic = new Map<string, DailyTrafficBucket>();
const dayLocks = new Map<string, Promise<unknown>>();

export function beijingDateKey(offsetDays = 0, nowMs = Date.now()): string {
  const shifted = nowMs + 8 * 3600_000 + offsetDays * 86_400_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function normalizeTrafficPath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/") return "/";
  if (clean === "/create") return "/create";
  if (clean === "/pricing") return "/pricing";
  if (clean === "/login") return "/login";
  if (clean === "/preview") return "/preview";
  if (clean.startsWith("/u/")) return "/u/*";
  if (clean.startsWith("/projects/")) return "/projects/*";
  if (clean === "/privacy" || clean === "/terms") return "/legal";
  return "/other";
}

export function isBotUserAgent(ua: string): boolean {
  if (!ua.trim()) return true;
  return BOT_UA_RE.test(ua);
}

export function shouldTrackTraffic(request: Request, pathname: string, response: Response): boolean {
  if (request.method !== "GET") return false;
  if (!response.ok) return false;
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return false;
  if (
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose") === "prefetch"
  ) {
    return false;
  }
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/")
  ) {
    return false;
  }
  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) return false;
  return true;
}

function extractClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return "unknown";
}

function extractReferrerSource(request: Request, currentHost: string): string {
  const ua = request.headers.get("user-agent") || "";
  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const host = refUrl.hostname.replace(/^www\./i, "").toLowerCase();
      const selfHost = currentHost.replace(/^www\./i, "").toLowerCase();
      if (host && host !== selfHost && host !== "localhost" && host !== "127.0.0.1") {
        if (host.includes("xiaohongshu") || host.includes("xhscdn")) return "xiaohongshu.com";
        if (host === "t.co" || host === "twitter.com") return "x.com";
        return host.slice(0, 64);
      }
    } catch {
      // ignore invalid referer URLs
    }
  }
  if (/micromessenger/i.test(ua)) return "wechat";
  return "direct";
}

async function hashVisitor(day: string, ip: string, ua: string): Promise<string> {
  const input = new TextEncoder().encode(`${day}|${ip}|${ua.slice(0, 120)}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < 6; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function emptyBucket(date: string): DailyTrafficBucket {
  return {
    date,
    pv: 0,
    uv: 0,
    hashes: [],
    pages: {},
    referrers: {},
    devices: { mobile: 0, desktop: 0 },
  };
}

function parseBucket(raw: string | null, date: string): DailyTrafficBucket {
  if (!raw) return emptyBucket(date);
  try {
    const parsed = JSON.parse(raw) as Partial<DailyTrafficBucket>;
    return {
      date,
      pv: Number(parsed.pv) || 0,
      uv: Number(parsed.uv) || 0,
      hashes: Array.isArray(parsed.hashes) ? parsed.hashes.filter((h): h is string => typeof h === "string") : [],
      pages: parsed.pages && typeof parsed.pages === "object" ? { ...parsed.pages } : {},
      referrers: parsed.referrers && typeof parsed.referrers === "object" ? { ...parsed.referrers } : {},
      devices: {
        mobile: Number(parsed.devices?.mobile) || 0,
        desktop: Number(parsed.devices?.desktop) || 0,
      },
    };
  } catch {
    return emptyBucket(date);
  }
}

async function withDayLock<T>(day: string, fn: () => Promise<T>): Promise<T> {
  const prev = dayLocks.get(day) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  dayLocks.set(day, next);
  try {
    return await next;
  } finally {
    if (dayLocks.get(day) === next) dayLocks.delete(day);
  }
}

export async function recordSiteTraffic(request: Request, pathname: string, env: PublishEnv): Promise<void> {
  const day = beijingDateKey();
  const ua = request.headers.get("user-agent") || "";
  const ip = extractClientIp(request);
  const host = new URL(request.url).hostname;
  const pageKey = normalizeTrafficPath(pathname);
  const refKey = extractReferrerSource(request, host);
  const device: "mobile" | "desktop" = MOBILE_UA_RE.test(ua) ? "mobile" : "desktop";
  const visitorHash = await hashVisitor(day, ip, ua);
  const storageKey = `traffic:day:${day}`;

  await withDayLock(day, async () => {
    const bucket = env.PROFILES_KV
      ? parseBucket(await env.PROFILES_KV.get(storageKey), day)
      : memTraffic.get(day) ?? emptyBucket(day);

    bucket.pv += 1;
    if (!bucket.hashes.includes(visitorHash)) {
      bucket.uv += 1;
      if (bucket.hashes.length < MAX_DAILY_HASHES) {
        bucket.hashes.push(visitorHash);
      }
    }
    bucket.pages[pageKey] = (bucket.pages[pageKey] ?? 0) + 1;
    if (bucket.referrers[refKey] !== undefined || Object.keys(bucket.referrers).length < MAX_REFERRER_KEYS) {
      bucket.referrers[refKey] = (bucket.referrers[refKey] ?? 0) + 1;
    }
    bucket.devices[device] += 1;

    if (env.PROFILES_KV) {
      await env.PROFILES_KV.put(storageKey, JSON.stringify(bucket));
    } else {
      memTraffic.set(day, bucket);
    }
  });
}

export async function readTrafficSummary(env: PublishEnv, days = 14): Promise<TrafficSummary> {
  const bucketMap = new Map<string, DailyTrafficBucket>();

  if (env.PROFILES_KV?.listPrefix) {
    const rows = await env.PROFILES_KV.listPrefix("traffic:day:", 90);
    for (const row of rows) {
      const date = row.key.slice("traffic:day:".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        bucketMap.set(date, parseBucket(row.value, date));
      }
    }
  } else if (env.PROFILES_KV) {
    const dates = Array.from({ length: days }, (_, i) => beijingDateKey(-(days - 1 - i)));
    const values = await Promise.all(dates.map((d) => env.PROFILES_KV!.get(`traffic:day:${d}`)));
    dates.forEach((d, idx) => {
      if (values[idx]) bucketMap.set(d, parseBucket(values[idx], d));
    });
  } else {
    for (const [date, bucket] of memTraffic.entries()) {
      bucketMap.set(date, bucket);
    }
  }

  let totalPv = 0;
  let totalUv = 0;
  for (const b of bucketMap.values()) {
    totalPv += b.pv;
    totalUv += b.uv;
  }

  const daily: Array<{ date: string; pv: number; uv: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = beijingDateKey(-i);
    const b = bucketMap.get(date);
    daily.push({ date, pv: b?.pv ?? 0, uv: b?.uv ?? 0 });
  }

  const today = beijingDateKey(0);
  const todayBucket = bucketMap.get(today);

  let last7dPv = 0;
  let last7dUv = 0;
  const pageTotals = new Map<string, number>();
  const refTotals = new Map<string, number>();
  const devices = { mobile: 0, desktop: 0 };

  for (let i = 0; i < 7; i += 1) {
    const b = bucketMap.get(beijingDateKey(-i));
    if (!b) continue;
    last7dPv += b.pv;
    last7dUv += b.uv;
    devices.mobile += b.devices.mobile;
    devices.desktop += b.devices.desktop;
    for (const [p, count] of Object.entries(b.pages)) {
      pageTotals.set(p, (pageTotals.get(p) ?? 0) + count);
    }
    for (const [r, count] of Object.entries(b.referrers)) {
      refTotals.set(r, (refTotals.get(r) ?? 0) + count);
    }
  }

  const pages = Array.from(pageTotals.entries())
    .map(([path, pv]) => ({ path, pv }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 10);

  const referrers = Array.from(refTotals.entries())
    .map(([source, pv]) => ({ source, pv }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 10);

  return {
    todayPv: todayBucket?.pv ?? 0,
    todayUv: todayBucket?.uv ?? 0,
    last7dPv,
    last7dUv,
    totalPv,
    totalUv,
    daily,
    pages,
    referrers,
    devices,
  };
}

export function resetMemoryTrafficForTests(): void {
  memTraffic.clear();
}
