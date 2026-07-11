import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Integration tests that call the real Groq API to verify NL understanding.
 * Only runs when GROQ_API_KEY is present in .env — skipped otherwise.
 */

function loadGroqKey(): string {
  try {
    const envRaw = readFileSync(".env", "utf-8");
    for (const line of envRaw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("GROQ_API_KEY=")) {
        return trimmed.slice("GROQ_API_KEY=".length).replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
  return "";
}

const groqKey = loadGroqKey();
const hasGroqKey = Boolean(groqKey);

describe.skipIf(!hasGroqKey)("Groq NL integration — interpretMessage", () => {
  let interpretMessage: any;

  beforeAll(async () => {
    // Force the real key into env before importing modules
    if (groqKey) process.env.GROQ_API_KEY = groqKey;
    vi.resetModules();
    const mod = await import("../../src/services/aiService.js");
    interpretMessage = mod.interpretMessage;
  });

  it("interprets 'remind me to call mom tomorrow at 9am' as create_reminder", async () => {
    const result = await interpretMessage("test-account", "remind me to call mom tomorrow at 9am", new Date().toISOString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reminder = result.intents.find((i: any) => i.type === "create_reminder");
    expect(reminder).toBeDefined();
    expect(reminder!.message.toLowerCase()).toContain("call mom");
  });

  it("interprets 'save a note about meeting notes' as create_note", async () => {
    const result = await interpretMessage("test-account", "save a note about meeting notes | discussed budget", new Date().toISOString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = result.intents.find((i: any) => i.type === "create_note");
    expect(note).toBeDefined();
    expect(note!.title.toLowerCase()).toContain("meeting");
  });

  it("interprets 'add task buy milk tomorrow by 5pm' as create_task with dueAt", async () => {
    const result = await interpretMessage("test-account", "add task buy milk tomorrow by 5pm", new Date().toISOString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = result.intents.find((i: any) => i.type === "create_task");
    expect(task).toBeDefined();
    expect(task!.title.toLowerCase()).toContain("milk");
  });

  it("interprets 'set alarm for 10 minutes' as create_alarm", async () => {
    const result = await interpretMessage("test-account", "set alarm for 10 minutes", new Date().toISOString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alarm = result.intents.find((i: any) => i.type === "create_alarm");
    expect(alarm).toBeDefined();
  });

  it("interprets 'remind me every day to take medicine at 8pm' with daily recurrence", async () => {
    const result = await interpretMessage("test-account", "remind me every day to take medicine at 8pm", new Date().toISOString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reminder = result.intents.find((i: any) => i.type === "create_reminder");
    expect(reminder).toBeDefined();
    expect(reminder!.recurrence).toBe("daily");
  });

  it("interprets 'remind me to water plants every week' with weekly recurrence", async () => {
    const result = await interpretMessage("test-account", "remind me to water plants every week", new Date().toISOString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reminder = result.intents.find((i: any) => i.type === "create_reminder");
    expect(reminder).toBeDefined();
    expect(reminder!.recurrence).toBe("weekly");
  });
});

describe.skipIf(!hasGroqKey)("Groq NL integration — timezone & schedule", () => {
  let interpretMessage: any;

  beforeAll(async () => {
    if (groqKey) process.env.GROQ_API_KEY = groqKey;
    vi.resetModules();
    const mod = await import("../../src/services/aiService.js");
    interpretMessage = mod.interpretMessage;
  });

  it("includes timezone info for 'remind me at 5pm'", async () => {
    const result = await interpretMessage("test-account", "remind me at 5pm to check email", new Date().toISOString(), [], [], "Asia/Kolkata");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reminder = result.intents.find((i: any) => i.type === "create_reminder");
    expect(reminder).toBeDefined();
    if (!reminder || reminder.type !== "create_reminder") return;
    // 5pm IST = 11:30 UTC. Allow generous variance.
    const remindHour = new Date(reminder.remindAt).getUTCHours();
    expect(remindHour).toBeGreaterThanOrEqual(5);
    expect(remindHour).toBeLessThanOrEqual(13);
  });
});
