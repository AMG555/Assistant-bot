import { describe, it, expect } from "vitest";
import { parseToolCall } from "../../src/services/aiService.js";

describe("parseToolCall — NL intent parsing pipeline", () => {
  describe("create_note", () => {
    it("parses a valid note intent", () => {
      const result = parseToolCall("create_note", JSON.stringify({ title: "Shopping list", body: "milk, eggs" }));
      expect(result).toEqual({ type: "create_note", title: "Shopping list", body: "milk, eggs" });
    });

    it("returns unrecognized for empty title", () => {
      const result = parseToolCall("create_note", JSON.stringify({ title: "", body: "" }));
      expect(result.type).toBe("unrecognized");
    });
  });

  describe("create_task", () => {
    it("parses a task without due date", () => {
      const result = parseToolCall("create_task", JSON.stringify({ title: "Buy groceries" }));
      expect(result).toEqual({ type: "create_task", title: "Buy groceries", dueAt: undefined });
    });

    it("parses a task with due date", () => {
      const result = parseToolCall("create_task", JSON.stringify({ title: "Pay bills", dueAtIso: "2026-07-15T10:00:00.000Z" }));
      expect(result).toEqual({ type: "create_task", title: "Pay bills", dueAt: "2026-07-15T10:00:00.000Z" });
    });

    it("returns unrecognized for empty title", () => {
      const result = parseToolCall("create_task", JSON.stringify({ title: "" }));
      expect(result.type).toBe("unrecognized");
    });
  });

  describe("create_reminder", () => {
    it("parses a one-time reminder", () => {
      const futureIso = new Date(Date.now() + 86400000).toISOString();
      const result = parseToolCall("create_reminder", JSON.stringify({ message: "Call mom", remindAtIso: futureIso, recurrence: "none" }));
      expect(result).toEqual({ type: "create_reminder", message: "Call mom", remindAt: futureIso, recurrence: "none" });
    });

    it("parses a recurring reminder", () => {
      const futureIso = new Date(Date.now() + 86400000).toISOString();
      const result = parseToolCall("create_reminder", JSON.stringify({ message: "Morning standup", remindAtIso: futureIso, recurrence: "daily" }));
      expect(result).toEqual({ type: "create_reminder", message: "Morning standup", remindAt: futureIso, recurrence: "daily" });
    });

    it("defaults unset recurrence to none", () => {
      const futureIso = new Date(Date.now() + 86400000).toISOString();
      const result = parseToolCall("create_reminder", JSON.stringify({ message: "Test", remindAtIso: futureIso }));
      expect(result).toEqual({ type: "create_reminder", message: "Test", remindAt: futureIso, recurrence: "none" });
    });

    it("returns unrecognized for empty message", () => {
      const result = parseToolCall("create_reminder", JSON.stringify({ message: "", remindAtIso: "2026-07-11T12:00:00.000Z" }));
      expect(result.type).toBe("unrecognized");
    });
  });

  describe("create_alarm", () => {
    it("parses a valid alarm intent", () => {
      const futureIso = new Date(Date.now() + 60000).toISOString();
      const result = parseToolCall("create_alarm", JSON.stringify({ message: "Wake up", remindAtIso: futureIso }));
      expect(result).toEqual({ type: "create_alarm", message: "Wake up", remindAt: futureIso });
    });

    it("returns unrecognized for past remindAt", () => {
      const result = parseToolCall("create_alarm", JSON.stringify({ message: "Too late", remindAtIso: "2020-01-01T00:00:00.000Z" }));
      expect(result.type).toBe("unrecognized");
    });
  });

  describe("answer_question", () => {
    it("parses a valid answer", () => {
      const result = parseToolCall("answer_question", JSON.stringify({ answer: "Your boss is John" }));
      expect(result).toEqual({ type: "answer_question", answer: "Your boss is John" });
    });

    it("returns unrecognized for empty answer", () => {
      const result = parseToolCall("answer_question", JSON.stringify({ answer: "" }));
      expect(result.type).toBe("unrecognized");
    });
  });

  describe("error handling", () => {
    it("returns unrecognized for invalid JSON", () => {
      const result = parseToolCall("create_note", "{broken json}");
      expect(result.type).toBe("unrecognized");
    });

    it("returns unrecognized for unknown tool name", () => {
      const result = parseToolCall("unknown_tool", "{}");
      expect(result.type).toBe("unrecognized");
    });

    it("returns unrecognized for missing required fields", () => {
      const result = parseToolCall("create_note", "{}");
      expect(result.type).toBe("unrecognized");
    });
  });
});
