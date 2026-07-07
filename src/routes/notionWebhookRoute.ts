import { Router } from "express";
import { verifyNotionWebhook } from "../middleware/verifyNotionWebhook.js";
import { handleInboundNotionPageEvent } from "../services/notionSyncService.js";
import { logError, logger } from "../lib/logger.js";

export const notionWebhookRouter = Router();

interface NotionWebhookBody {
  verification_token?: string;
  id?: string;
  type?: string;
  workspace_id?: string;
  data?: {
    page_id?: string;
    parent?: { type?: string; database_id?: string };
  };
}

notionWebhookRouter.post("/webhooks/notion", verifyNotionWebhook, async (req, res) => {
  const body = req.body as NotionWebhookBody;

  // The one-time verification challenge — acknowledge and stop. This
  // payload never reaches any account-mutating code path regardless of
  // whether the middleware let it through unsigned (see
  // verifyNotionWebhook.ts for why that's still safe).
  if (body.verification_token) {
    logger.info({ context: "notionWebhookRoute" }, "verification_token_logged_for_operator_setup");
    return res.status(200).json({ received: true });
  }

  const eventId = body.id;
  const workspaceId = body.workspace_id;
  const pageId = body.data?.page_id;

  if (!eventId || !workspaceId || !pageId) {
    logger.warn({ context: "notionWebhookRoute" }, "malformed_event_payload");
    return res.status(200).json({ received: true });
  }

  // Acknowledge after validation — quick check only, no DB/API calls.
  res.status(200).json({ received: true });

  // Only page-shaped events with a page_id are relevant to note sync;
  // other event types (comments, database schema changes, etc.) are
  // intentionally ignored for v1.
  try {
    const outcome = await handleInboundNotionPageEvent(eventId, workspaceId, pageId);
    logger.info({ context: "notionWebhookRoute", outcome, eventId }, "notion_event_processed");
  } catch (err) {
    logError("notionWebhookRoute.post", err, { eventId });
  }
});
