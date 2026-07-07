import { env } from "../config/env.js";
/**
 * Notion enforces an average of 3 requests/second PER INTEGRATION TOKEN
 * — and because this bot uses one shared OAuth app across every
 * connected user workspace, that ceiling is shared across ALL accounts
 * combined, not per-account. This is a real outbound throttle (queues
 * and waits for a slot), not a reject-based limiter like
 * middleware/rateLimit.ts — we choose when to call Notion, so the
 * correct behavior is "wait your turn," not "refuse the request."
 *
 * HONEST LIMITATION: in-memory, single-process — correct for Render's
 * free tier (one instance). If you ever run multiple instances, this
 * would need to move to a shared token bucket (e.g. a Supabase-backed
 * counter) since each instance would otherwise think it has the full
 * budget to itself.
 */
let nextAvailableSlotMs = 0;
let lock = Promise.resolve();
export async function throttleNotionCall(fn) {
    const minIntervalMs = 1000 / env.NOTION_MAX_REQUESTS_PER_SECOND;
    let scheduledAt;
    lock = lock.then(() => {
        const now = Date.now();
        scheduledAt = Math.max(now, nextAvailableSlotMs);
        nextAvailableSlotMs = scheduledAt + minIntervalMs;
    });
    await lock;
    const waitMs = scheduledAt - Date.now();
    if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return fn();
}
//# sourceMappingURL=notionThrottle.js.map