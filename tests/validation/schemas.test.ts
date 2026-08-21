import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createNoteSchema,
  createTaskSchema,
  createReminderSchema,
  setTimezoneSchema,
  linkCodeConsumeSchema,
  chartRequestSchema,
  setDigestSchema,
  snoozeReminderSchema,
  safeValidate,
} from "../../src/validation/schemas.js";

describe("safeValidate", () => {
  it("returns ok:true with parsed data on success", () => {
    const result = safeValidate(createNoteSchema, { title: "Test", body: "hello" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ title: "Test", body: "hello", tags: [] });
    }
  });

  it("returns ok:false with a joined error message on failure", () => {
    const result = safeValidate(createNoteSchema, { title: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Title is required");
    }
  });

  it("never throws even on wildly malformed input", () => {
    expect(() => safeValidate(createNoteSchema, null)).not.toThrow();
    expect(() => safeValidate(createNoteSchema, undefined)).not.toThrow();
    expect(() => safeValidate(createNoteSchema, "not an object")).not.toThrow();
    expect(() => safeValidate(createNoteSchema, 42)).not.toThrow();
  });
});

describe("createNoteSchema", () => {
  it("applies defaults for optional fields", () => {
    const result = safeValidate(createNoteSchema, { title: "T" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toBe("");
      expect(result.data.tags).toEqual([]);
    }
  });

  it("rejects an empty or missing title", () => {
    expect(safeValidate(createNoteSchema, { title: "" }).ok).toBe(false);
    expect(safeValidate(createNoteSchema, {}).ok).toBe(false);
  });

  it("rejects a title over 200 characters", () => {
    const result = safeValidate(createNoteSchema, { title: "a".repeat(201) });
    expect(result.ok).toBe(false);
  });

  it("trims whitespace from the title", () => {
    const result = safeValidate(createNoteSchema, { title: "  hello  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.title).toBe("hello");
  });

  it("rejects more than 10 tags", () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    expect(safeValidate(createNoteSchema, { title: "T", tags }).ok).toBe(false);
  });
});

describe("createTaskSchema", () => {
  it("defaults priority to 'normal' and leaves dueAt undefined", () => {
    const result = safeValidate(createTaskSchema, { title: "Buy milk" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.priority).toBe("normal");
      expect(result.data.dueAt).toBeUndefined();
    }
  });

  it("accepts an explicit due date and priority", () => {
    const result = safeValidate(createTaskSchema, {
      title: "Buy milk",
      dueAt: new Date("2026-08-01T00:00:00Z"),
      priority: "high",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.priority).toBe("high");
      expect(result.data.dueAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    }
  });

  it("rejects an invalid priority value", () => {
    const result = safeValidate(createTaskSchema, { title: "T", priority: "urgent" });
    expect(result.ok).toBe(false);
  });
});

describe("createReminderSchema", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a future reminder time and defaults recurrence to 'none'", () => {
    const result = safeValidate(createReminderSchema, {
      message: "call mom",
      remindAt: new Date("2026-07-05T13:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.recurrence).toBe("none");
  });

  it("rejects a reminder time in the past", () => {
    const result = safeValidate(createReminderSchema, {
      message: "call mom",
      remindAt: new Date("2026-07-05T11:00:00.000Z"),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty message", () => {
    const result = safeValidate(createReminderSchema, {
      message: "",
      remindAt: new Date("2026-07-05T13:00:00.000Z"),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid recurrence value", () => {
    const result = safeValidate(createReminderSchema, {
      message: "stretch",
      remindAt: new Date("2026-07-06T09:00:00.000Z"),
      recurrence: "daily",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.recurrence).toBe("daily");
  });

  it("rejects an invalid recurrence value", () => {
    const result = safeValidate(createReminderSchema, {
      message: "stretch",
      remindAt: new Date("2026-07-06T09:00:00.000Z"),
      recurrence: "hourly",
    });
    expect(result.ok).toBe(false);
  });
});

describe("setTimezoneSchema", () => {
  it("accepts a valid IANA timezone", () => {
    expect(safeValidate(setTimezoneSchema, { timeZone: "Asia/Kolkata" }).ok).toBe(true);
    expect(safeValidate(setTimezoneSchema, { timeZone: "America/New_York" }).ok).toBe(true);
    expect(safeValidate(setTimezoneSchema, { timeZone: "UTC" }).ok).toBe(true);
  });

  it("normalizes shorthand abbreviations to valid IANA names", () => {
    const ist = safeValidate(setTimezoneSchema, { timeZone: "IST" });
    expect(ist.ok).toBe(true);
    if (ist.ok) expect(ist.data.timeZone).toBe("Asia/Kolkata");

    const est = safeValidate(setTimezoneSchema, { timeZone: "est" });
    expect(est.ok).toBe(true);
    if (est.ok) expect(est.data.timeZone).toBe("America/New_York");

    const london = safeValidate(setTimezoneSchema, { timeZone: "London" });
    expect(london.ok).toBe(true);
    if (london.ok) expect(london.data.timeZone).toBe("Europe/London");
  });

  it("rejects an unrecognized timezone name", () => {
    const result = safeValidate(setTimezoneSchema, { timeZone: "Not/AZone" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Not a recognized timezone");
  });

  it("rejects an empty string", () => {
    expect(safeValidate(setTimezoneSchema, { timeZone: "" }).ok).toBe(false);
  });
});

describe("linkCodeConsumeSchema", () => {
  it("accepts a well-formed link code", () => {
    const result = safeValidate(linkCodeConsumeSchema, {
      code: "AB12CD",
      platform: "telegram",
      platformUserId: "123456",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a code with lowercase or symbol characters", () => {
    expect(
      safeValidate(linkCodeConsumeSchema, { code: "ab12cd", platform: "telegram", platformUserId: "1" }).ok
    ).toBe(false);
    expect(
      safeValidate(linkCodeConsumeSchema, { code: "AB12-D", platform: "telegram", platformUserId: "1" }).ok
    ).toBe(false);
  });

  it("rejects an unsupported platform value", () => {
    const result = safeValidate(linkCodeConsumeSchema, {
      code: "AB12CD",
      platform: "signal",
      platformUserId: "1",
    });
    expect(result.ok).toBe(false);
  });
});

describe("chartRequestSchema", () => {
  it("defaults both range and kind when omitted", () => {
    const result = safeValidate(chartRequestSchema, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ range: "7d", kind: "all" });
  });

  it("rejects an invalid range value", () => {
    expect(safeValidate(chartRequestSchema, { range: "90d" }).ok).toBe(false);
  });
});

describe("setDigestSchema", () => {
  it("accepts enabled without an hour", () => {
    expect(safeValidate(setDigestSchema, { enabled: true }).ok).toBe(true);
  });

  it("accepts a valid hour within 0-23", () => {
    expect(safeValidate(setDigestSchema, { enabled: true, hour: 0 }).ok).toBe(true);
    expect(safeValidate(setDigestSchema, { enabled: true, hour: 23 }).ok).toBe(true);
  });

  it("rejects an hour outside 0-23", () => {
    expect(safeValidate(setDigestSchema, { enabled: true, hour: 24 }).ok).toBe(false);
    expect(safeValidate(setDigestSchema, { enabled: true, hour: -1 }).ok).toBe(false);
  });
});

describe("snoozeReminderSchema", () => {
  it("accepts a valid id prefix and positive delay", () => {
    const result = safeValidate(snoozeReminderSchema, { idPrefix: "a1b2c3d4", delayMs: 3_600_000 });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-positive delay", () => {
    expect(safeValidate(snoozeReminderSchema, { idPrefix: "a1b2c3d4", delayMs: 0 }).ok).toBe(false);
    expect(safeValidate(snoozeReminderSchema, { idPrefix: "a1b2c3d4", delayMs: -1 }).ok).toBe(false);
  });

  it("rejects an id prefix shorter than 3 characters", () => {
    expect(safeValidate(snoozeReminderSchema, { idPrefix: "ab", delayMs: 1000 }).ok).toBe(false);
  });
});
