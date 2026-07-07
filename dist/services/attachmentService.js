import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { env } from "../config/env.js";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
/**
 * This is the internal "/api/upload" equivalent the spec calls for.
 * The bot adapters never talk to Supabase Storage directly — they call
 * this function, which is the only place that:
 *   1. Enforces size/type limits server-side (never trusts the
 *      platform's reported Content-Type alone).
 *   2. Scopes the storage path by accountId, which combined with a
 *      storage policy (see supabase/schema.sql comments) guarantees a
 *      user can never read another user's file even if they guess a URL.
 */
export async function uploadAttachment(accountId, fileBuffer, mimeType, originalName) {
    try {
        if (fileBuffer.byteLength === 0) {
            return { ok: false, error: "Empty file", code: "internal" };
        }
        if (fileBuffer.byteLength > MAX_BYTES) {
            return { ok: false, error: "File exceeds 10MB limit", code: "internal" };
        }
        if (!ALLOWED_MIME.has(mimeType)) {
            return { ok: false, error: "Unsupported file type", code: "internal" };
        }
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
        const objectPath = `${accountId}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabaseAdmin.storage
            .from(env.SUPABASE_STORAGE_BUCKET)
            .upload(objectPath, fileBuffer, { contentType: mimeType, upsert: false });
        if (error)
            throw error;
        return { ok: true, data: { path: objectPath } };
    }
    catch (err) {
        logError("uploadAttachment", err, { accountId, mimeType });
        return { ok: false, error: "Could not store attachment right now", code: "internal" };
    }
}
/** Issues a short-lived signed URL scoped to one object, instead of
 * ever making the bucket public. Expires quickly since it's only used
 * to let the bot re-send the file back to the requesting chat. */
export async function getSignedAttachmentUrl(objectPath, expiresInSeconds = 60) {
    try {
        const { data, error } = await supabaseAdmin.storage
            .from(env.SUPABASE_STORAGE_BUCKET)
            .createSignedUrl(objectPath, expiresInSeconds);
        if (error)
            throw error;
        if (!data?.signedUrl)
            return { ok: false, error: "Could not sign URL", code: "internal" };
        return { ok: true, data: { url: data.signedUrl } };
    }
    catch (err) {
        logError("getSignedAttachmentUrl", err, { objectPath });
        return { ok: false, error: "Could not access attachment right now", code: "internal" };
    }
}
//# sourceMappingURL=attachmentService.js.map