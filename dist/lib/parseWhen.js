import { nextOccurrenceOfClockTime } from "./timezone.js";
/**
 * Small, dependency-free "natural-ish" time parser for reminder input.
 * Supports (in order of precedence):
 *   - relative shorthand: "in 10m", "in 2h", "in 1d", "in 30s"
 *   - clock time in the user's own timezone: "at 9am", "9:30pm"
 *   - absolute ISO-8601: "2026-07-06T09:00:00Z"
 * Returns null (never throws) on anything it can't parse — callers
 * treat that as a validation failure, same as any other bad input.
 *
 * `timeZone` MUST be the resolving account's own IANA timezone
 * (accounts.timezone) — never a server-local default — otherwise "at
 * 9am" silently means 9am UTC for every user regardless of where they
 * actually are.
 */
const RELATIVE_PATTERN = /^in\s+(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/i;
const BARE_DURATION_PATTERN = /^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/i;
const CLOCK_TIME_PATTERN = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const UNIT_TO_MS = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
};
/** Parses a bare relative duration like "10m", "2h", "1d" (no "in "
 * prefix) into milliseconds. Shared by `parseWhen`'s "in <duration>"
 * handling and the `snooze <id> <duration>` command, so both accept
 * exactly the same duration grammar instead of maintaining two regexes
 * that could silently drift apart. Returns null on anything else. */
export function parseRelativeDurationMs(input) {
    const match = input.trim().match(BARE_DURATION_PATTERN);
    if (!match)
        return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const ms = UNIT_TO_MS[unit];
    if (!ms || !Number.isFinite(amount) || amount <= 0)
        return null;
    return amount * ms;
}
export function parseWhen(input, timeZone = "UTC") {
    const trimmed = input.trim();
    const relativeMatch = trimmed.match(RELATIVE_PATTERN);
    if (relativeMatch) {
        const durationMs = parseRelativeDurationMs(`${relativeMatch[1]}${relativeMatch[2]}`);
        if (!durationMs)
            return null;
        return new Date(Date.now() + durationMs);
    }
    const clockMatch = trimmed.match(CLOCK_TIME_PATTERN);
    if (clockMatch) {
        // Strip an optional leading "at " before delegating — the clock-time
        // resolver's own pattern only understands the bare time portion
        // (e.g. "9am", "21:30"), not the "at" prefix used in chat syntax.
        const bareTime = trimmed.replace(/^at\s+/i, "");
        const resolved = nextOccurrenceOfClockTime(bareTime, timeZone);
        if (resolved)
            return resolved;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime()))
        return parsed;
    return null;
}
/** Parses a bare hour-of-day expression like "7am", "7", "19", "8pm"
 * into a 0-23 integer. Used by the daily digest command, which only
 * needs hour granularity (matching accounts_due_for_digest's per-hour
 * check in schema.sql) — not full minute-precision clock parsing.
 * Returns null on anything unrecognized. */
export function parseHourOfDay(input) {
    const match = input.trim().match(/^(\d{1,2})\s*(am|pm)?$/i);
    if (!match)
        return null;
    let hour = Number(match[1]);
    const meridiem = match[2]?.toLowerCase();
    if (!meridiem && (hour < 0 || hour > 23))
        return null;
    if (meridiem && (hour < 1 || hour > 12))
        return null;
    if (meridiem === "pm" && hour < 12)
        hour += 12;
    if (meridiem === "am" && hour === 12)
        hour = 0;
    return hour;
}
const RECURRENCE_WORDS = {
    daily: "daily",
    "every day": "daily",
    everyday: "daily",
    weekly: "weekly",
    "every week": "weekly",
    monthly: "monthly",
    "every month": "monthly",
};
/** Extracts an optional trailing recurrence phrase (e.g. "every day",
 * "weekly") from a reminder request, returning both the recurrence rule
 * and the remaining text with that phrase stripped out. Never throws;
 * absence of a recognizable phrase just means recurrence "none". */
export function extractRecurrence(input) {
    const lower = input.toLowerCase();
    for (const [phrase, rule] of Object.entries(RECURRENCE_WORDS)) {
        const idx = lower.lastIndexOf(phrase);
        if (idx !== -1) {
            const remaining = (input.slice(0, idx) + input.slice(idx + phrase.length)).replace(/\s+/g, " ").trim();
            return { recurrence: rule, remaining };
        }
    }
    return { recurrence: "none", remaining: input };
}
/** Given a rule and the timestamp that just fired, computes the next
 * occurrence. Preserves the same wall-clock hour/minute in UTC terms —
 * good enough for daily/weekly; monthly uses UTC calendar month
 * arithmetic (clamping day-of-month for shorter months). */
export function computeNextOccurrence(rule, previousUtc) {
    if (rule === "none")
        return null;
    const next = new Date(previousUtc);
    if (rule === "daily") {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    else if (rule === "weekly") {
        next.setUTCDate(next.getUTCDate() + 7);
    }
    else if (rule === "monthly") {
        const targetDay = next.getUTCDate();
        next.setUTCMonth(next.getUTCMonth() + 1);
        // If the day rolled over (e.g. Jan 31 -> Mar 3), clamp to the last
        // valid day of the intended month instead of silently drifting.
        if (next.getUTCDate() !== targetDay) {
            next.setUTCDate(0);
        }
    }
    return next;
}
//# sourceMappingURL=parseWhen.js.map