import pino from "pino";
import { env } from "../config/env.js";
/**
 * Structured, level-based logging only. No emoji, no conversational
 * strings, no "🚀 done!" noise. Every log line is machine-parseable
 * JSON in production so it can be piped into any log aggregator.
 *
 * Sensitive fields (tokens, secrets, raw webhook bodies) must NEVER be
 * passed into `logger.*` calls — call sites redact before logging.
 */
export const logger = pino({
    level: env.NODE_ENV === "production" ? "info" : "debug",
    formatters: {
        level: (label) => ({ level: label }),
    },
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers[\"x-telegram-bot-api-secret-token\"]",
            "req.headers[\"x-internal-cron-secret\"]",
            "req.headers[\"x-hub-signature-256\"]",
            "*.token",
            "*.secret",
            "*.password",
        ],
        censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});
function normalizeError(err) {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack, name: err.name };
    }
    // Supabase/Postgrest and many third-party SDKs reject with plain
    // objects shaped like { message, code, details, hint } rather than a
    // real Error instance. Without this branch those all collapse to the
    // useless string "[object Object]" in logs.
    if (err && typeof err === "object" && "message" in err) {
        const obj = err;
        return {
            message: typeof obj.message === "string" ? obj.message : JSON.stringify(err),
            name: typeof obj.name === "string" ? obj.name : undefined,
            code: typeof obj.code === "string" ? obj.code : undefined,
        };
    }
    return { message: typeof err === "string" ? err : JSON.stringify(err) };
}
export function logError(context, err, meta = {}) {
    logger.error({ context, error: normalizeError(err), ...meta }, "operation_failed");
}
//# sourceMappingURL=logger.js.map