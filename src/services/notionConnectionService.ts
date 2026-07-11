import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { encryptSecret, decryptSecret } from "../lib/tokenCrypto.js";
import { env } from "../config/env.js";
import type { ServiceResult } from "./accountService.js";
import { hashCode } from "./accountService.js";

/** Issues a one-time OAuth state token for an account, hashed at rest —
 * identical pattern to link_codes in accountService.ts. This is the
 * CSRF-protection value embedded in the Notion authorize URL we hand
 * the user; Notion echoes it back to our callback route unmodified. */
export async function issueOAuthState(accountId: string): Promise<ServiceResult<{ state: string }>> {
  try {
    const state = crypto.randomBytes(24).toString("hex");
    const stateHash = hashCode(state);
    const expiresAt = new Date(Date.now() + env.OAUTH_STATE_TTL_MINUTES * 60_000).toISOString();

    const { error } = await supabaseAdmin.from("oauth_states").insert({
      account_id: accountId,
      provider: "notion",
      state_hash: stateHash,
      expires_at: expiresAt,
    });
    if (error) throw error;

    return { ok: true, data: { state } };
  } catch (err) {
    logError("issueOAuthState", err, { accountId });
    return { ok: false, error: "Could not start Notion connection right now", code: "internal" };
  }
}

/** Validates and consumes an OAuth state token from the callback
 * request, returning the account it was issued for. Timing-safe
 * comparison, single-use, expires — same discipline as consumeLinkCode. */
export async function consumeOAuthState(state: string): Promise<ServiceResult<{ accountId: string }>> {
  try {
    const stateHash = hashCode(state);

    const { data: candidates, error } = await supabaseAdmin
      .from("oauth_states")
      .select("id, account_id, state_hash, expires_at, consumed_at")
      .eq("provider", "notion")
      .is("consumed_at", null)
      .gte("expires_at", new Date().toISOString());
    if (error) throw error;

    const match = (candidates ?? []).find((row) =>
      crypto.timingSafeEqual(Buffer.from(row.state_hash), Buffer.from(stateHash))
    );
    if (!match) return { ok: false, error: "This connection link is invalid or has expired", code: "expired" };

    const { error: consumeError } = await supabaseAdmin
      .from("oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", match.id);
    if (consumeError) throw consumeError;

    return { ok: true, data: { accountId: match.account_id } };
  } catch (err) {
    logError("consumeOAuthState", err);
    return { ok: false, error: "Could not verify that connection request", code: "internal" };
  }
}

/** Stores a newly-obtained Notion access token, encrypted at rest.
 * Upserts on (account_id, workspace_id) so re-running OAuth for the
 * same workspace refreshes the stored token instead of duplicating a
 * row. */
export async function saveNotionConnection(
  accountId: string,
  workspaceId: string,
  workspaceName: string | undefined,
  accessToken: string
): Promise<ServiceResult<null>> {
  try {
    const encrypted = encryptSecret(accessToken);

    const { error } = await supabaseAdmin.from("notion_connections").upsert(
      {
        account_id: accountId,
        workspace_id: workspaceId,
        workspace_name: workspaceName ?? null,
        access_token_encrypted: encrypted.ciphertext,
        access_token_iv: encrypted.iv,
        access_token_auth_tag: encrypted.authTag,
      },
      { onConflict: "account_id,workspace_id" }
    );
    if (error) throw error;

    return { ok: true, data: null };
  } catch (err) {
    logError("saveNotionConnection", err, { accountId });
    return { ok: false, error: "Could not save the Notion connection", code: "internal" };
  }
}

export interface NotionConnection {
  id: string;
  accountId: string;
  workspaceId: string;
  workspaceName: string | null;
  accessToken: string;
  databaseId: string | null;
}

/** Retrieves and decrypts an account's Notion connection, if any. The
 * decrypted token exists only in memory for the duration of the
 * calling request — it is never logged, never re-serialized to a
 * client, and never persisted anywhere outside this function's return
 * value. */
export async function getNotionConnection(accountId: string): Promise<ServiceResult<NotionConnection | null>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("notion_connections")
      .select("id, account_id, workspace_id, workspace_name, access_token_encrypted, access_token_iv, access_token_auth_tag, database_id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    const accessToken = decryptSecret({
      ciphertext: data.access_token_encrypted,
      iv: data.access_token_iv,
      authTag: data.access_token_auth_tag,
    });

    return {
      ok: true,
      data: {
        id: data.id,
        accountId: data.account_id,
        workspaceId: data.workspace_id,
        workspaceName: data.workspace_name,
        accessToken,
        databaseId: data.database_id,
      },
    };
  } catch (err) {
    logError("getNotionConnection", err, { accountId });
    return { ok: false, error: "Could not load your Notion connection", code: "internal" };
  }
}

/** Looks up a connection by Notion workspace_id — used by the inbound
 * webhook handler, which only knows the workspace, not which of our
 * accounts it belongs to. Decrypts the token for the same reason as
 * getNotionConnection above. */
export async function getNotionConnectionByWorkspace(workspaceId: string): Promise<ServiceResult<NotionConnection | null>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("notion_connections")
      .select("id, account_id, workspace_id, workspace_name, access_token_encrypted, access_token_iv, access_token_auth_tag, database_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    const accessToken = decryptSecret({
      ciphertext: data.access_token_encrypted,
      iv: data.access_token_iv,
      authTag: data.access_token_auth_tag,
    });

    return {
      ok: true,
      data: {
        id: data.id,
        accountId: data.account_id,
        workspaceId: data.workspace_id,
        workspaceName: data.workspace_name,
        accessToken,
        databaseId: data.database_id,
      },
    };
  } catch (err) {
    logError("getNotionConnectionByWorkspace", err, { workspaceId });
    return { ok: false, error: "Could not resolve Notion connection", code: "internal" };
  }
}

export async function setNotionDatabaseId(accountId: string, databaseId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin.from("notion_connections").update({ database_id: databaseId }).eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("setNotionDatabaseId", err, { accountId });
    return { ok: false, error: "Could not set the Notion database", code: "internal" };
  }
}

export async function disconnectNotion(accountId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin.from("notion_connections").delete().eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("disconnectNotion", err, { accountId });
    return { ok: false, error: "Could not disconnect Notion right now", code: "internal" };
  }
}

/** Idempotency guard for inbound webhook events — Notion documents that
 * deliveries can be retried. Returns true if this is the first time
 * we've seen this event id (and records it), false if it's a duplicate
 * that should be silently skipped. */
export async function recordWebhookEventOnce(eventId: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("notion_webhook_events").insert({ event_id: eventId });
    if (error) {
      // Unique violation means we've already processed this event id —
      // that is the expected, correct outcome for a duplicate delivery,
      // not a real error.
      if ((error as { code?: string }).code === "23505") return false;
      throw error;
    }
    return true;
  } catch (err) {
    logError("recordWebhookEventOnce", err, { eventId });
    // Fail closed toward "treat as duplicate" would risk dropping a
    // legitimate event; failing open toward "treat as new" risks a
    // double-import in the rare case of a logging error. A double
    // import (overwriting a note with the same content again) is the
    // less harmful failure mode here, so we proceed.
    return true;
  }
}

// Re-exported for callers that only need the encryption key presence
// check without importing config/env directly.
export const notionTokenEncryptionConfigured = Boolean(env.NOTION_TOKEN_ENCRYPTION_KEY);
