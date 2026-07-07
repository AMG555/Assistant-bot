import crypto from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
/**
 * Notion's webhook setup has two phases (see docs/notion-sync.md):
 *   1. A one-time verification POST containing only
 *      { "verification_token": "..." } — no signature exists yet,
 *      because the token itself hasn't been recorded on Notion's side
 *      as our shared secret until we paste it back into their dashboard.
 *      We deliberately allow this ONE payload shape through unsigned,
 *      but ONLY when it contains exactly this shape and nothing else —
 *      it carries no note/task data and cannot be used to trigger any
 *      account mutation.
 *   2. Every subsequent real event includes an X-Notion-Signature
 *      header: an HMAC-SHA256 of the raw body, signed with the
 *      verification_token you configured as NOTION_WEBHOOK_SECRET.
 *      These MUST be verified before any processing.
 */
export function verifyNotionWebhook(req, res, next) {
    const rawBody = req.rawBody;
    const body = req.body;
    // Phase 1: the one-time, unsigned verification challenge.
    if (body && typeof body.verification_token === "string" && Object.keys(body).length === 1) {
        logger.info({ context: "verifyNotionWebhook" }, "notion_verification_challenge_received");
        return next();
    }
    if (!env.NOTION_WEBHOOK_SECRET) {
        logger.warn({ context: "verifyNotionWebhook" }, "webhook_secret_not_configured");
        return res.status(503).json({ error: "notion_webhook_not_configured" });
    }
    const signatureHeader = req.header("x-notion-signature") ?? "";
    if (!rawBody || !signatureHeader.startsWith("sha256=")) {
        logger.warn({ context: "verifyNotionWebhook" }, "missing_signature");
        return res.status(401).json({ error: "unauthorized" });
    }
    const expectedHex = crypto.createHmac("sha256", env.NOTION_WEBHOOK_SECRET).update(rawBody).digest("hex");
    const providedHex = signatureHeader.slice("sha256=".length);
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const providedBuf = Buffer.from(providedHex, "hex");
    const isValid = expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
    if (!isValid) {
        logger.warn({ context: "verifyNotionWebhook" }, "rejected_invalid_signature");
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
//# sourceMappingURL=verifyNotionWebhook.js.map