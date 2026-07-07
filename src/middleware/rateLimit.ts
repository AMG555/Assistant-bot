import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

/**
 * In-memory sliding-window limiter, keyed by an arbitrary caller-chosen
 * string (e.g. `telegram:<chatId>` or `link-code:<accountId>`).
 *
 * HONEST LIMITATION: this state lives in the Node process's memory.
 * On Render's free tier you run exactly one instance, so this is
 * correct today. If you ever scale to multiple instances, swap this
 * for a shared store (Supabase table or Redis) — the interface below
 * is intentionally small so that swap is a one-file change.
 */
interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();
let lock: Promise<void> = Promise.resolve();

export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return true;
  }

  if (existing.count >= max) {
    return false;
  }

  existing.count += 1;
  return true;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Express middleware factory for HTTP-triggered actions (e.g. a future
 * password-reset-style endpoint). Chat commands use `checkRateLimit`
 * directly inside their handler instead, since there's no per-route
 * Express boundary for individual bot commands. */
export function rateLimitMiddleware(options: { max: number; windowMs: number; keyFn: (req: Request) => string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.keyFn(req);
    const allowed = checkRateLimit(key, options.max, options.windowMs);

    if (!allowed) {
      logger.warn({ context: "rateLimitMiddleware", key }, "rate_limit_exceeded");
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    next();
  };
}
