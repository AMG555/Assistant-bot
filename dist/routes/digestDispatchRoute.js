import { Router } from "express";
import { verifyCronSecret } from "../middleware/verifyCronSecret.js";
import { fetchAccountsDueForDigest, buildDigestContent, formatDigestMessage, markDigestSentToday } from "../services/digestService.js";
import { deliverToAccount } from "../lib/deliverToAccount.js";
import { isAiEnabledForAccount } from "../services/accountService.js";
import { summarizeDigest } from "../services/aiService.js";
import { isGroqConfigured } from "../config/env.js";
import { logError, logger } from "../lib/logger.js";
export const digestRouter = Router();
/**
 * Rewrites the raw bullet-list digest into a short natural-language
 * paragraph via Groq, IF AND ONLY IF this account has opted into AI
 * ("ai on") — same opt-in gate as every other AI feature, since sending
 * digest content (task/reminder/note titles) to Groq is exactly as
 * privacy-sensitive as sending a typed chat message. Falls back to the
 * original bullet-list message on ANY failure (not configured, rate
 * limited, provider error) so a Groq outage never blocks a digest from
 * being delivered — this is a presentation enhancement, never a
 * dependency of the digest actually reaching the user.
 */
async function maybeSummarizeWithAi(accountId, bulletMessage) {
    if (!isGroqConfigured)
        return bulletMessage;
    try {
        if (!(await isAiEnabledForAccount(accountId)))
            return bulletMessage;
        const summaryResult = await summarizeDigest(accountId, bulletMessage);
        if (!summaryResult.ok)
            return bulletMessage;
        return summaryResult.summary;
    }
    catch (err) {
        logError("digestDispatchRoute.maybeSummarizeWithAi", err, { accountId });
        return bulletMessage;
    }
}
/**
 * Called by a separate Supabase pg_cron job (see schema.sql), on a
 * coarser schedule than the reminder dispatcher (e.g. every 15-30 min
 * is plenty, since digest is hour-granular, not minute-granular).
 * Guarded by the same shared cron secret as /internal/cron/dispatch —
 * this is not a new trust boundary, just a new scheduled job hitting an
 * equally-protected route.
 */
digestRouter.post("/internal/cron/digest", verifyCronSecret, async (_req, res) => {
    try {
        const dueResult = await fetchAccountsDueForDigest();
        if (!dueResult.ok) {
            return res.status(500).json({ error: dueResult.error });
        }
        let sent = 0;
        let failed = 0;
        for (const account of dueResult.data) {
            const contentResult = await buildDigestContent(account.accountId, account.timezone);
            if (!contentResult.ok) {
                failed += 1;
                continue;
            }
            const bulletMessage = formatDigestMessage(contentResult.data);
            const message = await maybeSummarizeWithAi(account.accountId, bulletMessage);
            const delivered = await deliverToAccount(account.accountId, message);
            // Mark as sent regardless of delivery success: a failed delivery
            // here almost always means "no reachable platform identity",
            // which will keep failing every cycle for the rest of the day —
            // retrying every 15-30 minutes forever would be noise, not
            // resilience. This mirrors the reminder dispatcher's attempt cap
            // in spirit, just applied per-day instead of per-attempt-count.
            await markDigestSentToday(account.accountId, account.timezone);
            if (delivered)
                sent += 1;
            else
                failed += 1;
        }
        logger.info({ context: "digestDispatchRoute", sent, failed, total: dueResult.data.length }, "digest_dispatch_cycle_complete");
        return res.status(200).json({ sent, failed, total: dueResult.data.length });
    }
    catch (err) {
        logError("digestDispatchRoute.dispatch", err);
        return res.status(500).json({ error: "internal_error" });
    }
});
//# sourceMappingURL=digestDispatchRoute.js.map