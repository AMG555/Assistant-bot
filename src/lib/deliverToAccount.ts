import { supabaseAdmin } from "./supabase.js";
import { logError } from "./logger.js";
import { sendTelegramMessage } from "../adapters/telegram/client.js";
import { sendWhatsAppText } from "../adapters/whatsapp/client.js";
import { isWhatsAppConfigured } from "../config/env.js";
import { getOutgoingWebhookUrl } from "../services/accountService.js";

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
export async function deliverToAccount(accountId: string, message: string): Promise<boolean> {
  try {
    const { data: identities, error } = await supabaseAdmin
      .from("platform_identities")
      .select("platform, platform_user_id")
      .eq("account_id", accountId)
      .in("platform", isWhatsAppConfigured ? ["telegram", "whatsapp"] : ["telegram"]);
    if (error) throw error;

    if (!identities || identities.length === 0) return false;

    const results = await Promise.all(
      identities.map((identity) => {
        if (identity.platform === "telegram") {
          return sendTelegramMessage(identity.platform_user_id, message);
        }
        if (identity.platform === "whatsapp") {
          return sendWhatsAppText(identity.platform_user_id, message);
        }
        return Promise.resolve(false);
      })
    );

    // Fire-and-forget outgoing webhook: POST the message to the account's
    // configured URL. Never blocks or fails the main delivery path.
    void fireOutgoingWebhook(accountId, message);

    return results.some(Boolean);
  } catch (err) {
    logError("deliverToAccount", err, { accountId });
    return false;
  }
}

async function fireOutgoingWebhook(accountId: string, text: string): Promise<void> {
  try {
    const url = await getOutgoingWebhookUrl(accountId);
    if (!url) return;

    const body = JSON.stringify({ event: "message_sent", text });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Outgoing webhooks are best-effort — log and swallow.
  }
}
