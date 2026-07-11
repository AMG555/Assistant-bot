import { supabaseAdmin } from "./supabase.js";
import { logError } from "./logger.js";

export async function fireEvent(
  accountId: string,
  event: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("outgoing_webhook_url")
      .eq("id", accountId)
      .single();
    if (!account?.outgoing_webhook_url) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(account.outgoing_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    logError("fireEvent", err, { accountId, event });
  }
}
