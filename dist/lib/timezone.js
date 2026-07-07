/**
 * Timezone-aware date math using only built-in Intl — no external tz
 * database dependency (Node ships its own ICU tz data, kept current via
 * Node version updates).
 */
/** Validates an IANA timezone name by attempting to construct a
 * formatter with it. This correctly accepts both canonical names (e.g.
 * "Asia/Calcutta") and long-standing aliases (e.g. "Asia/Kolkata") that
 * Node's ICU data resolves, even when they don't appear in the
 * `Intl.supportedValuesOf("timeZone")` canonical list. */
export function isValidTimeZone(tz) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    }
    catch {
        return false;
    }
}
/** Returns the UTC offset, in milliseconds, that `timeZone` had at the
 * instant `date` represents. Handles DST transitions correctly because
 * it re-derives the offset for the specific date given, not a cached
 * static offset. */
function getTimezoneOffsetMs(timeZone, date) {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    const parts = {};
    for (const part of dtf.formatToParts(date)) {
        parts[part.type] = part.value;
    }
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - date.getTime();
}
/** Converts a wall-clock date/time as understood in `timeZone` into the
 * correct absolute UTC Date instance. E.g. "9:00 AM" in "Asia/Kolkata"
 * on 2026-07-06 becomes 2026-07-06T03:30:00.000Z. */
export function zonedWallTimeToUtc(year, month, // 1-12
day, hour, minute, timeZone) {
    const initialGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offsetMs = getTimezoneOffsetMs(timeZone, new Date(initialGuessMs));
    return new Date(initialGuessMs - offsetMs);
}
/**
 * Parses a simple "HH:MM" or "H:MM am/pm" clock-time string and resolves
 * it against a reference "now", in the given timezone, choosing the next
 * future occurrence (today if the time hasn't passed yet in that zone,
 * otherwise tomorrow). Returns null if the string isn't a recognizable
 * clock time.
 */
export function nextOccurrenceOfClockTime(input, timeZone, now = new Date()) {
    const match = input.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match)
        return null;
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3]?.toLowerCase();
    if (minute < 0 || minute > 59)
        return null;
    // Hour range depends on whether am/pm was given: a 12-hour clock
    // value must be 1-12 (e.g. "13pm" or "15am" are nonsensical and must
    // be rejected, not silently accepted), while a bare 24-hour value
    // must be 0-23. (A previous version only checked `hour > 23`
    // unconditionally, which let invalid combinations like "15am" through
    // — caught by a real test asserting nextOccurrenceOfClockTime rejects
    // out-of-range hour+meridiem combinations, matching the equivalent,
    // already-correct check in parseWhen.ts's parseHourOfDay.)
    if (meridiem && (hour < 1 || hour > 12))
        return null;
    if (!meridiem && (hour < 0 || hour > 23))
        return null;
    if (meridiem === "pm" && hour < 12)
        hour += 12;
    if (meridiem === "am" && hour === 12)
        hour = 0;
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = {};
    for (const part of dtf.formatToParts(now))
        parts[part.type] = part.value;
    const todayCandidate = zonedWallTimeToUtc(Number(parts.year), Number(parts.month), Number(parts.day), hour, minute, timeZone);
    if (todayCandidate.getTime() > now.getTime())
        return todayCandidate;
    // Roll forward to the next calendar day in that timezone.
    const tomorrow = new Date(todayCandidate.getTime() + 24 * 60 * 60 * 1000);
    const dtfTomorrow = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const tParts = {};
    for (const part of dtfTomorrow.formatToParts(tomorrow))
        tParts[part.type] = part.value;
    return zonedWallTimeToUtc(Number(tParts.year), Number(tParts.month), Number(tParts.day), hour, minute, timeZone);
}
/** Returns the current local hour (0-23) and a stable "YYYY-MM-DD" date
 * key for `timeZone` at instant `now`. Used by the daily digest
 * dispatcher to decide (a) whether it's currently the account's chosen
 * digest hour, and (b) whether today's digest has already been sent —
 * comparing date keys, not timestamps, is what makes this correct
 * across a dyno that might run the check multiple times within the
 * same target hour. */
export function getLocalHourAndDateKey(timeZone, now = new Date()) {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
    });
    const parts = {};
    for (const part of dtf.formatToParts(now))
        parts[part.type] = part.value;
    return {
        hour: Number(parts.hour),
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    };
}
//# sourceMappingURL=timezone.js.map