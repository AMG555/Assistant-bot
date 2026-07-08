import { supabaseAdmin } from "./supabase.js";

/**
 * Fire-and-forget event to the account's outgoing webhook URL.
 * Never throws — all failures are silently swallowed.
 */
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
  } catch {
    // fire-and-forget — swallow all errors
  }
}
