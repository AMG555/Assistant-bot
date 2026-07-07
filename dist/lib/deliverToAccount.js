import { supabaseAdmin } from "./supabase.js";
import { logError } from "./logger.js";
import { sendTelegramMessage } from "../adapters/telegram/client.js";
import { sendWhatsAppText } from "../adapters/whatsapp/client.js";
import { isWhatsAppConfigured } from "../config/env.js";
/**
 * Delivers an unsolicited, bot-initiated message to every linked
 * identity of an account, across whichever platforms support proactive
 * (non-reply) messages. Shared by the reminder dispatcher and the daily
 * digest dispatcher — both are "we decided to message the user, they
 * didn't just ask us something" flows, so they share the same platform
 * capability constraint:
 *
 * Discord's interaction-webhook model cannot push a DM without a prior
 * interaction/token (no persistent Gateway connection on this free-tier
 * deployment), so Discord-only accounts cannot receive proactive
 * messages until/unless a Gateway-based adapter is added. Telegram and
 * WhatsApp bot APIs both support genuinely unsolicited sends.
 *
 * Returns true if delivered to at least one linked identity.
 */
export async function deliverToAccount(accountId, message) {
    try {
        const { data: identities, error } = await supabaseAdmin
            .from("platform_identities")
            .select("platform, platform_user_id")
            .eq("account_id", accountId)
            .in("platform", isWhatsAppConfigured ? ["telegram", "whatsapp"] : ["telegram"]);
        if (error)
            throw error;
        if (!identities || identities.length === 0)
            return false;
        const results = await Promise.all(identities.map((identity) => {
            if (identity.platform === "telegram") {
                return sendTelegramMessage(identity.platform_user_id, message);
            }
            if (identity.platform === "whatsapp") {
                return sendWhatsAppText(identity.platform_user_id, message);
            }
            return Promise.resolve(false);
        }));
        return results.some(Boolean);
    }
    catch (err) {
        logError("deliverToAccount", err, { accountId });
        return false;
    }
}
//# sourceMappingURL=deliverToAccount.js.map