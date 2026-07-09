export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

export function createRateLimiter(options: { max: number; windowMs: number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return function check(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= options.max) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true };
  };
}
