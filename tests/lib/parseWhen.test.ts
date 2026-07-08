import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseRelativeDurationMs,
  parseWhen,
  parseHourOfDay,
  extractRecurrence,
  computeNextOccurrence,
} from "../../src/lib/parseWhen.js";

describe("parseRelativeDurationMs", () => {
  it("parses each supported unit correctly", () => {
    expect(parseRelativeDurationMs("30s")).toBe(30 * 1000);
    expect(parseRelativeDurationMs("10m")).toBe(10 * 60_000);
    expect(parseRelativeDurationMs("2h")).toBe(2 * 3_600_000);
    expect(parseRelativeDurationMs("1d")).toBe(1 * 86_400_000);
  });

  it("accepts long-form unit spellings", () => {
    expect(parseRelativeDurationMs("5mins")).toBe(5 * 60_000);
    expect(parseRelativeDurationMs("3hrs")).toBe(3 * 3_600_000);
    expect(parseRelativeDurationMs("2days")).toBe(2 * 86_400_000);
  });

  it("accepts full English unit words", () => {
    expect(parseRelativeDurationMs("30 seconds")).toBe(30 * 1000);
    expect(parseRelativeDurationMs("5 minutes")).toBe(5 * 60_000);
    expect(parseRelativeDurationMs("2 hours")).toBe(2 * 3_600_000);
    expect(parseRelativeDurationMs("1 day")).toBe(1 * 86_400_000);
  });

  it("rejects zero, negative, and non-numeric amounts", () => {
    expect(parseRelativeDurationMs("0m")).toBeNull();
    expect(parseRelativeDurationMs("-5m")).toBeNull();
    expect(parseRelativeDurationMs("banana")).toBeNull();
  });

  it("rejects a bare number with no unit", () => {
    expect(parseRelativeDurationMs("10")).toBeNull();
  });
});

describe("parseWhen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves 'in <duration>' relative to the current fixed time", () => {
    const result = parseWhen("in 2h");
    expect(result?.toISOString()).toBe("2026-07-05T14:00:00.000Z");
  });

  it("resolves 'in <duration>' with full English unit words", () => {
    expect(parseWhen("in 30 seconds")?.toISOString()).toBe("2026-07-05T12:00:30.000Z");
    expect(parseWhen("in 5 minutes")?.toISOString()).toBe("2026-07-05T12:05:00.000Z");
    expect(parseWhen("in 2 hours")?.toISOString()).toBe("2026-07-05T14:00:00.000Z");
    expect(parseWhen("in 1 day")?.toISOString()).toBe("2026-07-06T12:00:00.000Z");
  });

  it("resolves clock times against the given timezone, not UTC by default vs explicit", () => {
    // Default timezone is UTC when omitted.
    const utcResult = parseWhen("at 9am");
    expect(utcResult?.toISOString()).toBe("2026-07-06T09:00:00.000Z"); // 9am UTC already passed today (it's noon UTC) -> tomorrow

    const istResult = parseWhen("at 9am", "Asia/Kolkata");
    // At fixed time 12:00 UTC, IST local time is 17:30 -- 9am IST already
    // passed today, so it rolls to tomorrow: 2026-07-06T03:30:00Z.
    expect(istResult?.toISOString()).toBe("2026-07-06T03:30:00.000Z");
  });

  it("parses an absolute ISO-8601 timestamp regardless of timezone argument", () => {
    const result = parseWhen("2026-08-01T10:00:00Z");
    expect(result?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("returns null for unparseable input", () => {
    expect(parseWhen("whenever")).toBeNull();
    expect(parseWhen("")).toBeNull();
  });
});

describe("parseHourOfDay", () => {
  it("parses plain 24-hour numbers", () => {
    expect(parseHourOfDay("0")).toBe(0);
    expect(parseHourOfDay("19")).toBe(19);
    expect(parseHourOfDay("23")).toBe(23);
  });

  it("parses am/pm correctly, including the 12am/12pm edge cases", () => {
    expect(parseHourOfDay("8am")).toBe(8);
    expect(parseHourOfDay("8pm")).toBe(20);
    expect(parseHourOfDay("12am")).toBe(0);
    expect(parseHourOfDay("12pm")).toBe(12);
  });

  it("rejects out-of-range or invalid input", () => {
    expect(parseHourOfDay("25")).toBeNull();
    expect(parseHourOfDay("13pm")).toBeNull();
    expect(parseHourOfDay("banana")).toBeNull();
    expect(parseHourOfDay("")).toBeNull();
  });
});

describe("extractRecurrence", () => {
  it("extracts 'every day' style phrases and strips them from the remainder", () => {
    expect(extractRecurrence("stretch at 9am every day")).toEqual({
      recurrence: "daily",
      remaining: "stretch at 9am",
    });
  });

  it("extracts bare recurrence words", () => {
    expect(extractRecurrence("pay rent monthly")).toEqual({
      recurrence: "monthly",
      remaining: "pay rent",
    });
    expect(extractRecurrence("standup weekly")).toEqual({
      recurrence: "weekly",
      remaining: "standup",
    });
  });

  it("defaults to 'none' when no recurrence phrase is present", () => {
    expect(extractRecurrence("call mom in 2h")).toEqual({
      recurrence: "none",
      remaining: "call mom in 2h",
    });
  });
});

describe("computeNextOccurrence", () => {
  it("returns null for a 'none' rule", () => {
    expect(computeNextOccurrence("none", new Date("2026-07-05T09:00:00Z"))).toBeNull();
  });

  it("adds one day for 'daily'", () => {
    const result = computeNextOccurrence("daily", new Date("2026-07-05T09:00:00Z"));
    expect(result?.toISOString()).toBe("2026-07-06T09:00:00.000Z");
  });

  it("adds seven days for 'weekly'", () => {
    const result = computeNextOccurrence("weekly", new Date("2026-07-05T09:00:00Z"));
    expect(result?.toISOString()).toBe("2026-07-12T09:00:00.000Z");
  });

  it("adds one calendar month for 'monthly' in the simple case", () => {
    const result = computeNextOccurrence("monthly", new Date("2026-03-15T09:00:00Z"));
    expect(result?.toISOString()).toBe("2026-04-15T09:00:00.000Z");
  });

  it("clamps end-of-month overflow instead of drifting into the next month", () => {
    // Jan 31 + 1 month would naively overflow to March 3rd; it should
    // clamp to the last valid day of February instead.
    const result = computeNextOccurrence("monthly", new Date("2026-01-31T09:00:00Z"));
    expect(result?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });
});
