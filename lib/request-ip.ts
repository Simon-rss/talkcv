export interface RequestIpEnv {
  TRUST_X_FORWARDED_FOR?: string;
}

/**
 * Extract the client IP safely.
 * Priority:
 * 1. `cf-connecting-ip` (set by Cloudflare edge proxy)
 * 2. `x-forwarded-for` first hop ONLY when `TRUST_X_FORWARDED_FOR === "1"`
 *    or when running on localhost / test hosts without `cf-connecting-ip`.
 */
export function getClientIp(request: Request, env?: RequestIpEnv): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  let isLocalHost = false;
  try {
    const host = new URL(request.url).hostname.toLowerCase();
    isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    isLocalHost = false;
  }

  if (env?.TRUST_X_FORWARDED_FOR === "1" || isLocalHost) {
    const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff;
  }

  return "unknown";
}
