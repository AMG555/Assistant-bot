import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { fireEvent } from "../lib/eventBus.js";
import type { CreateNoteInput } from "../validation/schemas.js";
import type { ServiceResult } from "./accountService.js";

export async function createNote(
  accountId: string,
  input: CreateNoteInput
): Promise<ServiceResult<{ id: string }>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("notes")
      .insert({
        account_id: accountId,
        title: input.title,
        body: input.body,
        tags: input.tags,
      })
      .select("id")
      .single();
    if (error) throw error;

    void supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "note_created" });
    void fireEvent(accountId, "note_created", { title: input.title, body: input.body });

    return { ok: true, data: { id: data.id } };
  } catch (err) {
    logError("createNote", err, { accountId });
    return { ok: false, error: "Could not save note right now", code: "internal" };
  }
}

/** Deletes a note outright — used only by the undo mechanism to revert
 * a `note ...` creation. Scoped by account_id, same ownership
 * discipline as every other mutation in this codebase. */
export async function deleteNote(accountId: string, noteId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin.from("notes").delete().eq("id", noteId).eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("deleteNote", err, { accountId, noteId });
    return { ok: false, error: "Could not undo that right now", code: "internal" };
  }
}

export interface NoteRecord {
  id: string;
  accountId: string;
  title: string;
  body: string;
  notionPageId: string | null;
  notionLastSyncedEdit: string | null;
  updatedAt: string;
}

export async function getNoteById(accountId: string, noteId: string): Promise<ServiceResult<NoteRecord | null>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("notes")
      .select("id, account_id, title, body, notion_page_id, notion_last_synced_edit, updated_at")
      .eq("id", noteId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        id: data.id,
        accountId: data.account_id,
        title: data.title,
        body: data.body,
        notionPageId: data.notion_page_id,
        notionLastSyncedEdit: data.notion_last_synced_edit,
        updatedAt: data.updated_at,
      },
    };
  } catch (err) {
    logError("getNoteById", err, { accountId, noteId });
    return { ok: false, error: "Could not load that note right now", code: "internal" };
  }
}

export async function getNoteByNotionPageId(pageId: string): Promise<ServiceResult<NoteRecord | null>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("notes")
      .select("id, account_id, title, body, notion_page_id, notion_last_synced_edit, updated_at")
      .eq("notion_page_id", pageId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        id: data.id,
        accountId: data.account_id,
        title: data.title,
        body: data.body,
        notionPageId: data.notion_page_id,
        notionLastSyncedEdit: data.notion_last_synced_edit,
        updatedAt: data.updated_at,
      },
    };
  } catch (err) {
    logError("getNoteByNotionPageId", err, { pageId });
    return { ok: false, error: "Could not resolve that Notion page", code: "internal" };
  }
}

/** Records that a note is now linked to a Notion page, and stamps the
 * last-synced edit time. This stamp is the loop-guard: an inbound
 * webhook for this exact edit will see notion_last_synced_edit already
 * matches and skip re-importing it as if it were a NEW external change. */
export async function linkNoteToNotionPage(noteId: string, notionPageId: string, lastEditedTime: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin
      .from("notes")
      .update({ notion_page_id: notionPageId, notion_last_synced_edit: lastEditedTime })
      .eq("id", noteId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("linkNoteToNotionPage", err, { noteId, notionPageId });
    return { ok: false, error: "Could not record Notion sync state", code: "internal" };
  }
}

/** Applies an inbound change from Notion into our own note content —
 * used only by the webhook handler pulling a fresh edit. Scoped by
 * account_id implicitly via the caller having already resolved the
 * note through getNoteByNotionPageId, which is workspace-scoped by the
 * connection lookup upstream. */
export async function applyInboundNotionEdit(
  noteId: string,
  title: string,
  body: string,
  lastEditedTime: string
): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin
      .from("notes")
      .update({ title, body, notion_last_synced_edit: lastEditedTime, updated_at: new Date().toISOString() })
      .eq("id", noteId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("applyInboundNotionEdit", err, { noteId });
    return { ok: false, error: "Could not apply Notion update", code: "internal" };
  }
}

/** Stores a computed embedding vector on a note. Scoped by account_id
 * for the same ownership reasons as every other mutation here, even
 * though this is only ever called internally right after a note this
 * account just created/edited (never from user-controlled input). */
export async function setNoteEmbedding(
  accountId: string,
  noteId: string,
  embeddingLiteral: string
): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin
      .from("notes")
      .update({ embedding: embeddingLiteral })
      .eq("id", noteId)
      .eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("setNoteEmbedding", err, { accountId, noteId });
    return { ok: false, error: "Could not store embedding", code: "internal" };
  }
}

export async function listRecentNotes(
  accountId: string,
  limit = 10
): Promise<ServiceResult<Array<{ id: string; title: string; updatedAt: string }>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("notes")
      .select("id, title, updated_at")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updated_at })),
    };
  } catch (err) {
    logError("listRecentNotes", err, { accountId });
    return { ok: false, error: "Could not load notes right now", code: "internal" };
  }
}
