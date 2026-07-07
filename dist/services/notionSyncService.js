import { getNotionConnection, getNotionConnectionByWorkspace, recordWebhookEventOnce } from "./notionConnectionService.js";
import { createNotionPage, updateNotionPage, getNotionPage, extractTitleAndBody } from "./notionClient.js";
import { getNoteById, getNoteByNotionPageId, linkNoteToNotionPage, applyInboundNotionEdit } from "./notesService.js";
import { logError, logger } from "../lib/logger.js";
/**
 * Pushes a bot-created (or bot-edited) note out to the user's connected
 * Notion database, if they have one configured. This is deliberately
 * fire-and-forget from the caller's perspective — a Notion outage or a
 * user who hasn't connected Notion must NEVER block or fail the actual
 * note creation, which is the primary action. Sync is a best-effort
 * side effect, not a dependency of the core feature.
 */
export async function pushNoteToNotion(accountId, noteId) {
    try {
        const connectionResult = await getNotionConnection(accountId);
        if (!connectionResult.ok || !connectionResult.data || !connectionResult.data.databaseId) {
            return; // not connected, or connected but no database chosen yet — nothing to do
        }
        const connection = connectionResult.data;
        const databaseId = connectionResult.data.databaseId;
        const noteResult = await getNoteById(accountId, noteId);
        if (!noteResult.ok || !noteResult.data)
            return;
        const note = noteResult.data;
        const existingPageId = note.notionPageId;
        if (existingPageId) {
            const updateResult = await updateNotionPage(connection.accessToken, existingPageId, note.title, note.body);
            if (!updateResult.ok || !updateResult.data) {
                logger.warn({ context: "pushNoteToNotion", accountId, noteId }, "notion_update_failed");
                return;
            }
            await linkNoteToNotionPage(noteId, existingPageId, updateResult.data.last_edited_time);
        }
        else {
            const createResult = await createNotionPage(connection.accessToken, databaseId, note.title, note.body);
            if (!createResult.ok || !createResult.data) {
                logger.warn({ context: "pushNoteToNotion", accountId, noteId }, "notion_create_failed");
                return;
            }
            await linkNoteToNotionPage(noteId, createResult.data.id, createResult.data.last_edited_time);
        }
    }
    catch (err) {
        // Never let a Notion sync failure surface as an error to the note
        // creation flow that triggered it — this function's contract is
        // "best effort, never throws."
        logError("pushNoteToNotion", err, { accountId, noteId });
    }
}
/**
 * Handles one inbound Notion webhook event notifying us that a page
 * changed. Fetches the fresh page content (webhook payloads are
 * notifications, not full snapshots) and applies it to our note —
 * UNLESS the page's last_edited_time is not newer than what we last
 * synced ourselves, which means this edit IS the one we just pushed
 * out, and applying it again would create an infinite bot-writes ->
 * webhook-fires -> bot-writes-again loop.
 */
export async function handleInboundNotionPageEvent(eventId, workspaceId, pageId) {
    const isNewEvent = await recordWebhookEventOnce(eventId);
    if (!isNewEvent)
        return "skipped_duplicate_event";
    try {
        const connectionResult = await getNotionConnectionByWorkspace(workspaceId);
        if (!connectionResult.ok || !connectionResult.data)
            return "skipped_not_found";
        const connection = connectionResult.data;
        const noteResult = await getNoteByNotionPageId(pageId);
        if (!noteResult.ok || !noteResult.data)
            return "skipped_not_found";
        const note = noteResult.data;
        const pageResult = await getNotionPage(connection.accessToken, pageId);
        if (!pageResult.ok || !pageResult.data)
            return "error";
        const freshLastEdited = pageResult.data.last_edited_time;
        // Loop guard: if the page's last_edited_time is not strictly newer
        // than the edit we last wrote ourselves, this webhook is notifying
        // us about our OWN write, not a genuine external change.
        if (note.notionLastSyncedEdit && freshLastEdited <= note.notionLastSyncedEdit) {
            return "skipped_loop_guard";
        }
        const { title, body } = extractTitleAndBody(pageResult.data.properties);
        const applyResult = await applyInboundNotionEdit(note.id, title, body, freshLastEdited);
        if (!applyResult.ok)
            return "error";
        return "applied";
    }
    catch (err) {
        logError("handleInboundNotionPageEvent", err, { workspaceId, pageId });
        return "error";
    }
}
//# sourceMappingURL=notionSyncService.js.map