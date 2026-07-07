import crypto from "node:crypto";
import { env, isWhatsAppConfigured } from "../config/env.js";
import { logger } from "../lib/logger.js";
/**
 * Meta's Cloud API signs the webhook body with HMAC-SHA256 using your
 * App Secret. If WhatsApp credentials are not configured (they require
 * Meta Business verification which only you can complete), this
 * middleware fails CLOSED with 503 — it never falls through and
 * pretends to accept unverified WhatsApp traffic.
 */
export function verifyWhatsAppWebhook(req, res, next) {
    if (!isWhatsAppConfigured) {
        logger.warn({ context: "verifyWhatsAppWebhook" }, "adapter_not_configured");
        return res.status(503).json({ error: "whatsapp_adapter_disabled" });
    }
    const signatureHeader = req.header("x-hub-signature-256") ?? "";
    const rawBody = req.rawBody;
    if (!rawBody || !signatureHeader.startsWith("sha256=")) {
        logger.warn({ context: "verifyWhatsAppWebhook" }, "missing_signature");
        return res.status(401).json({ error: "unauthorized" });
    }
    const expectedHex = crypto
        .createHmac("sha256", env.WHATSAPP_APP_SECRET)
        .update(rawBody)
        .digest("hex");
    const providedHex = signatureHeader.slice("sha256=".length);
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const providedBuf = Buffer.from(providedHex, "hex");
    const isValid = expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
    if (!isValid) {
        logger.warn({ context: "verifyWhatsAppWebhook" }, "rejected_invalid_signature");
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
//# sourceMappingURL=verifyWhatsApp.js.map