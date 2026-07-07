import crypto from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
/** Guards the one route Supabase pg_cron is allowed to call. This is
 * the equivalent of a service-to-service API key — never reused for
 * anything user-facing. */
export function verifyCronSecret(req, res, next) {
    const provided = req.header("x-internal-cron-secret") ?? "";
    const expected = env.INTERNAL_CRON_SECRET;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    const isValid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
    if (!isValid) {
        logger.warn({ context: "verifyCronSecret" }, "rejected_unauthorized_cron_call");
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
//# sourceMappingURL=verifyCronSecret.js.map