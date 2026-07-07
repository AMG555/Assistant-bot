/**
 * Tracks the single most recent undoable action per account, so a user
 * can send "undo" right after a mistake without needing to remember or
 * retype an id.
 *
 * HONEST LIMITATION (same pattern as src/middleware/rateLimit.ts): this
 * lives in the Node process's memory. On Render's free tier you run
 * exactly one instance, so this is correct today, but:
 *   - it does NOT survive a process restart (deploy, crash, or a cold
 *     start after the dyno slept) — "undo" a few hours later, after the
 *     dyno went to sleep and woke back up, will correctly report
 *     "nothing to undo" rather than silently doing nothing.
 *   - if you ever scale to multiple instances, swap this for a shared
 *     store (a small Supabase table) — the interface below is
 *     intentionally narrow so that swap is a one-file change.
 *
 * Each recorded action also expires after a short window so "undo"
 * can never accidentally revert something from an unrelated, much
 * earlier part of a conversation.
 */
const UNDO_TTL_MS = 5 * 60 * 1000;
const lastActionByAccount = new Map();
export function recordUndoableAction(accountId, action) {
    lastActionByAccount.set(accountId, { action, recordedAt: Date.now() });
}
/** Retrieves and clears the pending undo action for an account, if any
 * and if still within the TTL window. Clearing on read means a second
 * "undo" in a row correctly reports "nothing to undo" instead of
 * reversing the same action twice. */
export function takeUndoableAction(accountId) {
    const stored = lastActionByAccount.get(accountId);
    if (!stored)
        return null;
    lastActionByAccount.delete(accountId);
    if (Date.now() - stored.recordedAt > UNDO_TTL_MS)
        return null;
    return stored.action;
}
//# sourceMappingURL=undoStore.js.map