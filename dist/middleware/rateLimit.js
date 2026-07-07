import { logger } from "../lib/logger.js";
const buckets = new Map();
let lock = Promise.resolve();
export function checkRateLimit(key, max, windowMs) {
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
export function resetRateLimit(key) {
    buckets.delete(key);
}
/** Express middleware factory for HTTP-triggered actions (e.g. a future
 * password-reset-style endpoint). Chat commands use `checkRateLimit`
 * directly inside their handler instead, since there's no per-route
 * Express boundary for individual bot commands. */
export function rateLimitMiddleware(options) {
    return (req, res, next) => {
        const key = options.keyFn(req);
        const allowed = checkRateLimit(key, options.max, options.windowMs);
        if (!allowed) {
            logger.warn({ context: "rateLimitMiddleware", key }, "rate_limit_exceeded");
            return res.status(429).json({ error: "Too many requests. Please try again later." });
        }
        next();
    };
}
//# sourceMappingURL=rateLimit.js.map