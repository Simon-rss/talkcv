export interface RateLimitWindow {
  count: number;
  resetAt: number;
}

/**
 * Memory-bounded fixed-window rate limiter with automatic TTL eviction.
 * Prevents unbounded Map growth in long-running Node.js processes.
 */
export class BoundedRateLimiter {
  private readonly store = new Map<string, RateLimitWindow>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxEntries: number;

  constructor(options: { windowMs: number; maxRequests: number; maxEntries?: number }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.maxEntries = options.maxEntries ?? 5000;
  }

  private evictIfNeeded(now: number): void {
    if (this.store.size < this.maxEntries) return;
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  check(key: string, now = Date.now()): boolean {
    const entry = this.store.get(key);
    if (!entry || now >= entry.resetAt) {
      this.store.delete(key);
      this.evictIfNeeded(now);
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.maxRequests) return false;
    entry.count += 1;
    return true;
  }

  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.store.get(key);
    if (!entry || now >= entry.resetAt) return 0;
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Memory-bounded cooldown map (key -> timestamp ms).
 */
export class BoundedCooldownMap {
  private readonly store = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { ttlMs: number; maxEntries?: number }) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 5000;
  }

  private evictIfNeeded(now: number): void {
    if (this.store.size < this.maxEntries) return;
    for (const [k, ts] of this.store) {
      if (now - ts >= this.ttlMs) this.store.delete(k);
    }
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  get(key: string, now = Date.now()): number | undefined {
    const ts = this.store.get(key);
    if (ts === undefined) return undefined;
    if (now - ts >= this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return ts;
  }

  set(key: string, now = Date.now()): void {
    this.store.delete(key);
    this.evictIfNeeded(now);
    this.store.set(key, now);
  }

  clear(): void {
    this.store.clear();
  }
}
