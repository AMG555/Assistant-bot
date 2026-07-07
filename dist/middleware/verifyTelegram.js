import crypto from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
/**
 * Telegram signs nothing in the body, but guarantees delivery only to
 * the URL you registered via setWebhook with a `secret_token`. Telegram
 * echoes that secret back on every call in a header. We compare it in
 * constant time — this is the moral equivalent of certificate pinning
 * for a webhook-based integration: it proves the request genuinely
 * originated from Telegram's infrastructure and not a forged POST.
 */
export function verifyTelegramWebhook(req, res, next) {
    const provided = req.header("x-telegram-bot-api-secret-token") ?? "";
    const expected = env.TELEGRAM_WEBHOOK_SECRET;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    const isValid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
    if (!isValid) {
        logger.warn({ context: "verifyTelegramWebhook" }, "rejected_unverified_webhook");
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
//# sourceMappingURL=verifyTelegram.js.map