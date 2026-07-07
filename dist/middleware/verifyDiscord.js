import nacl from "tweetnacl";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
/**
 * Discord signs every interaction payload with Ed25519 using your
 * application's public key. This is the strongest of the three
 * verification mechanisms here (asymmetric signature, not shared
 * secret) and MUST run against the raw request body bytes, before JSON
 * parsing mutates/reorders anything.
 */
export function verifyDiscordInteraction(req, res, next) {
    const signature = req.header("x-signature-ed25519");
    const timestamp = req.header("x-signature-timestamp");
    const rawBody = req.rawBody;
    if (!signature || !timestamp || !rawBody) {
        logger.warn({ context: "verifyDiscordInteraction" }, "missing_signature_headers");
        return res.status(401).json({ error: "unauthorized" });
    }
    try {
        const isValid = nacl.sign.detached.verify(Buffer.concat([Buffer.from(timestamp), rawBody]), Buffer.from(signature, "hex"), Buffer.from(env.DISCORD_PUBLIC_KEY, "hex"));
        if (!isValid) {
            logger.warn({ context: "verifyDiscordInteraction" }, "rejected_invalid_signature");
            return res.status(401).json({ error: "unauthorized" });
        }
        next();
    }
    catch (err) {
        logger.warn({ context: "verifyDiscordInteraction" }, "signature_verification_error");
        return res.status(401).json({ error: "unauthorized" });
    }
}
//# sourceMappingURL=verifyDiscord.js.map