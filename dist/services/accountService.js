import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { env } from "../config/env.js";
/**
 * Resolves (or lazily creates) the account behind a given platform
 * identity. This is the ONLY place a new account gets created, which
 * keeps the "one identity = one isolated data vault" invariant in one
 * auditable spot.
 */
export async function resolveOrCreateAccount(platform, platformUserId, displayName) {
    try {
        const { data: existing, error: lookupError } = await supabaseAdmin
            .from("platform_identities")
            .select("account_id")
            .eq("platform", platform)
            .eq("platform_user_id", platformUserId)
            .maybeSingle();
        if (lookupError)
            throw lookupError;
        if (existing)
            return { ok: true, data: { accountId: existing.account_id } };
        const { data: account, error: accountError } = await supabaseAdmin
            .from("accounts")
            .insert({ display_name: displayName ?? null })
            .select("id")
            .single();
        if (accountError)
            throw accountError;
        const { error: identityError } = await supabaseAdmin.from("platform_identities").insert({
            account_id: account.id,
            platform,
            platform_user_id: platformUserId,
            display_name: displayName ?? null,
        });
        if (identityError)
            throw identityError;
        return { ok: true, data: { accountId: account.id } };
    }
    catch (err) {
        logError("resolveOrCreateAccount", err, { platform });
        return { ok: false, error: "Could not resolve account", code: "internal" };
    }
}
/** Reads whether an account has explicitly opted in to AI features.
 * Defaults closed (false) on any lookup failure — an error here must
 * never accidentally enable sending a user's data to a third party. */
export async function isAiEnabledForAccount(accountId) {
    try {
        const { data, error } = await supabaseAdmin
            .from("accounts")
            .select("ai_enabled")
            .eq("id", accountId)
            .single();
        if (error)
            throw error;
        return Boolean(data?.ai_enabled);
    }
    catch (err) {
        logError("isAiEnabledForAccount", err, { accountId });
        return false;
    }
}
export async function setAiEnabledForAccount(accountId, enabled) {
    try {
        const { error } = await supabaseAdmin.from("accounts").update({ ai_enabled: enabled }).eq("id", accountId);
        if (error)
            throw error;
        return { ok: true, data: null };
    }
    catch (err) {
        logError("setAiEnabledForAccount", err, { accountId });
        return { ok: false, error: "Could not update AI setting right now", code: "internal" };
    }
}
/** Defaults to "UTC" on any lookup failure — never silently applies an
 * unvalidated or stale timezone. */
export async function getAccountTimeZone(accountId) {
    try {
        const { data, error } = await supabaseAdmin.from("accounts").select("timezone").eq("id", accountId).single();
        if (error)
            throw error;
        return data?.timezone || "UTC";
    }
    catch (err) {
        logError("getAccountTimeZone", err, { accountId });
        return "UTC";
    }
}
export async function setAccountTimeZone(accountId, timeZone) {
    try {
        const { error } = await supabaseAdmin.from("accounts").update({ timezone: timeZone }).eq("id", accountId);
        if (error)
            throw error;
        return { ok: true, data: null };
    }
    catch (err) {
        logError("setAccountTimeZone", err, { accountId });
        return { ok: false, error: "Could not update timezone right now", code: "internal" };
    }
}
/** Enables the daily digest for an account, optionally at a specific
 * local hour (defaults to 8am in the account's own timezone). Digest is
 * opt-in and off by default, same posture as AI — unsolicited proactive
 * messaging is something a user must explicitly ask for. */
export async function setDigestEnabled(accountId, enabled, hour) {
    try {
        const update = { digest_enabled: enabled };
        if (hour !== undefined)
            update.digest_hour = hour;
        const { error } = await supabaseAdmin.from("accounts").update(update).eq("id", accountId);
        if (error)
            throw error;
        return { ok: true, data: null };
    }
    catch (err) {
        logError("setDigestEnabled", err, { accountId });
        return { ok: false, error: "Could not update digest setting right now", code: "internal" };
    }
}
function hashCode(code) {
    return crypto.createHash("sha256").update(code).digest("hex");
}
function generateHumanCode() {
    // Avoids ambiguous chars (0/O, 1/I) for something a user has to
    // retype on a phone keyboard from another device.
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}
/** Issues a one-time link code for an existing account. Code is hashed
 * before storage, exactly like a password would be — the plaintext is
 * returned once, to the user, and never persisted. */
export async function issueLinkCode(accountId) {
    try {
        const code = generateHumanCode();
        const codeHash = hashCode(code);
        const expiresAt = new Date(Date.now() + env.LINK_CODE_TTL_MINUTES * 60_000).toISOString();
        const { error } = await supabaseAdmin.from("link_codes").insert({
            account_id: accountId,
            code_hash: codeHash,
            expires_at: expiresAt,
        });
        if (error)
            throw error;
        return { ok: true, data: { code, expiresAt } };
    }
    catch (err) {
        logError("issueLinkCode", err, { accountId });
        return { ok: false, error: "Could not create link code", code: "internal" };
    }
}
/** Consumes a link code and attaches a new platform identity to the
 * code's account. Uses a timing-safe compare against the stored hash. */
export async function consumeLinkCode(code, platform, platformUserId, displayName) {
    try {
        const codeHash = hashCode(code);
        const { data: candidates, error } = await supabaseAdmin
            .from("link_codes")
            .select("id, account_id, code_hash, expires_at, consumed_at")
            .is("consumed_at", null)
            .gte("expires_at", new Date().toISOString());
        if (error)
            throw error;
        const match = (candidates ?? []).find((row) => crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(codeHash)));
        if (!match) {
            return { ok: false, error: "Code is invalid or has expired", code: "expired" };
        }
        const { error: consumeError } = await supabaseAdmin
            .from("link_codes")
            .update({ consumed_at: new Date().toISOString() })
            .eq("id", match.id);
        if (consumeError)
            throw consumeError;
        const { error: upsertError } = await supabaseAdmin.from("platform_identities").upsert({
            account_id: match.account_id,
            platform,
            platform_user_id: platformUserId,
            display_name: displayName ?? null,
        }, { onConflict: "platform,platform_user_id" });
        if (upsertError)
            throw upsertError;
        return { ok: true, data: { accountId: match.account_id } };
    }
    catch (err) {
        logError("consumeLinkCode", err, { platform });
        return { ok: false, error: "Could not link account", code: "internal" };
    }
}
/** Returns the existing webhook secret for an account, or generates one
 * if none exists yet. The secret is a random hex string stored in
 * accounts.webhook_secret and presented by the caller as the
 * X-Webhook-Secret header when POSTing to /webhooks/incoming/:accountId. */
export async function getOrCreateWebhookSecret(accountId) {
    try {
        const { data, error } = await supabaseAdmin
            .from("accounts")
            .select("webhook_secret")
            .eq("id", accountId)
            .single();
        if (error)
            throw error;
        let secret = data?.webhook_secret;
        if (!secret) {
            secret = crypto.randomBytes(24).toString("hex");
            const { error: updateError } = await supabaseAdmin
                .from("accounts")
                .update({ webhook_secret: secret })
                .eq("id", accountId);
            if (updateError)
                throw updateError;
        }
        const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
        return { ok: true, data: { secret, url: `${baseUrl}/webhooks/incoming/${accountId}` } };
    }
    catch (err) {
        logError("getOrCreateWebhookSecret", err, { accountId });
        return { ok: false, error: "Could not create webhook secret", code: "internal" };
    }
}
/** Validates a webhook secret for an account. Returns true if the secret
 * matches what's stored. Timing-safe comparison to prevent side-channel
 * attacks (same pattern as link code verification). */
export async function validateWebhookSecret(accountId, candidate) {
    try {
        const { data, error } = await supabaseAdmin
            .from("accounts")
            .select("webhook_secret")
            .eq("id", accountId)
            .single();
        if (error || !data?.webhook_secret)
            return false;
        return crypto.timingSafeEqual(Buffer.from(data.webhook_secret), Buffer.from(candidate));
    }
    catch (err) {
        logError("validateWebhookSecret", err, { accountId });
        return false;
    }
}
//# sourceMappingURL=accountService.js.map