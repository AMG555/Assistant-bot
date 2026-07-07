import { Router, type Request, type Response } from "express";
import { validateWebhookSecret } from "../services/accountService.js";
import { createNote } from "../services/notesService.js";
import { logError } from "../lib/logger.js";

export const webhookIncomingRouter = Router();

/**
 * POST /webhooks/incoming/:accountId
 *
 * Accepts an external HTTP POST and saves the payload as a note for the
 * identified account. Authenticated via the X-Webhook-Secret header.
 *
 * Request body (JSON):
 *   { "text": "string", "title": "optional title", "source": "optional label" }
 *
 * The `text` field is required. If `title` is omitted, a default title
 * like "Webhook from <source>" or "Incoming webhook" is used.
 *
 * Usage examples:
 *
 *   curl -X POST https://your-bot.com/webhooks/incoming/<accountId> \
 *     -H "Content-Type: application/json" \
 *     -H "X-Webhook-Secret: <your-secret>" \
 *     -d '{"text":"Buy milk and eggs from webhook test","source":"n8n"}'
 *
 *   curl -X POST https://your-bot.com/webhooks/incoming/<accountId> \
 *     -H "Content-Type: application/json" \
 *     -H "X-Webhook-Secret: <your-secret>" \
 *     -d '{"title":"GitHub PR","text":"PR #42 merged: fix login bug"}'
 */
webhookIncomingRouter.post("/webhooks/incoming/:accountId", async (req: Request, res: Response) => {
  try {
    const accountId = req.params.accountId as string;
    if (!accountId) {
      res.status(400).json({ error: "missing_account_id" });
      return;
    }

    const secretHeader = req.headers["x-webhook-secret"];
    const secret = typeof secretHeader === "string" ? secretHeader : undefined;
    if (!secret) {
      res.status(401).json({ error: "missing_webhook_secret" });
      return;
    }

    const valid = await validateWebhookSecret(accountId, secret);
    if (!valid) {
      res.status(403).json({ error: "invalid_webhook_secret" });
      return;
    }

    const body = req.body ?? {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "missing_text" });
      return;
    }

    const source = typeof body.source === "string" ? body.source.trim() : "";
    const customTitle = typeof body.title === "string" ? body.title.trim() : "";
    const title = customTitle || (source ? `Webhook from ${source}` : "Incoming webhook");

    const result = await createNote(accountId, { title, body: text, tags: ["webhook"] });
    if (!result.ok) {
      res.status(500).json({ error: "failed_to_save_note" });
      return;
    }

    res.status(200).json({ ok: true, noteId: result.data.id });
  } catch (err) {
    logError("webhookIncoming", err, { accountId: req.params.accountId as string });
    res.status(500).json({ error: "internal_error" });
  }
});
