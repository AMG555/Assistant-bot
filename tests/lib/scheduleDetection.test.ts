import { describe, it, expect } from "vitest";

const schedulePatterns = [
  /^schedule$/i, /^today$/i, /^my day$/i, /^agenda$/i,
  /^(what'?s?|show|tell)\s.*(today|schedule|agenda|on|due|up)/i,
  /^(about|for)\s.*(today|schedule|agenda)/i,
  /what\s.*(have|do|is)\s.*(today|due)/i,
  /todays?\s+schedule/i, /today'?s?\s+(plan|agenda)/i,
  /how'?s?\s+(my|the)\s+day|how\s+is\s+(my|the)\s+day/i,
  /(what'?s?|anything)\s+(on|due)\s+today/i,
  /what'?s?\s+(happening|going\s+on|coming\s+up)/i,
  /plan\s+(for\s+)?today/i,
  /do\s+i\s+have\s+(anything|something)\s+(today|due)/i,
  /anything\s+(planned|scheduled|going\s+on)\s+(for\s+)?today/i,
];

function isScheduleQuery(lower: string): boolean {
  if (schedulePatterns.some((p) => p.test(lower))) return true;
  if (["schedule", "agenda"].some((k) => lower.includes(k))) return true;
  if (lower.includes("today") && ["have", "on", "due", "plan", "my", "what", "show", "tell", "about", "for", "anything", "upcoming", "going", "happening"].some((w) => lower.includes(w))) return true;
  return false;
}

describe("schedule query detection", () => {
  it("matches exact keywords", () => {
    expect(isScheduleQuery("schedule")).toBe(true);
    expect(isScheduleQuery("today")).toBe(true);
    expect(isScheduleQuery("my day")).toBe(true);
    expect(isScheduleQuery("agenda")).toBe(true);
  });

  it("matches what/show/tell variants", () => {
    expect(isScheduleQuery("what's on my schedule")).toBe(true);
    expect(isScheduleQuery("what is today's schedule")).toBe(true);
    expect(isScheduleQuery("whats due today")).toBe(true);
    expect(isScheduleQuery("show me my schedule")).toBe(true);
    expect(isScheduleQuery("tell me about today")).toBe(true);
    expect(isScheduleQuery("what's up for today")).toBe(true);
  });

  it("matches about/for variants", () => {
    expect(isScheduleQuery("about today")).toBe(true);
    expect(isScheduleQuery("about today's schedule")).toBe(true);
    expect(isScheduleQuery("for today")).toBe(true);
  });

  it("matches 'what do I have' variants", () => {
    expect(isScheduleQuery("what do I have today")).toBe(true);
    expect(isScheduleQuery("what do I have due")).toBe(true);
  });

  it("matches 'today' variants", () => {
    expect(isScheduleQuery("todays schedule")).toBe(true);
    expect(isScheduleQuery("today's plan")).toBe(true);
    expect(isScheduleQuery("today's agenda")).toBe(true);
  });

  it("matches 'how's my day'", () => {
    expect(isScheduleQuery("how's my day")).toBe(true);
    expect(isScheduleQuery("how is my day")).toBe(true);
    expect(isScheduleQuery("how's the day")).toBe(true);
  });

  it("matches 'what's on / anything on due today'", () => {
    expect(isScheduleQuery("what's on today")).toBe(true);
    expect(isScheduleQuery("anything due today")).toBe(true);
    expect(isScheduleQuery("whats on today")).toBe(true);
  });

  it("matches 'what's happening/going on/coming up'", () => {
    expect(isScheduleQuery("what's happening today")).toBe(true);
    expect(isScheduleQuery("what's going on today")).toBe(true);
    expect(isScheduleQuery("whats coming up")).toBe(true);
  });

  it("matches 'plan for today'", () => {
    expect(isScheduleQuery("plan for today")).toBe(true);
    expect(isScheduleQuery("plan today")).toBe(true);
  });

  it("matches 'do I have anything/something'", () => {
    expect(isScheduleQuery("do I have anything today")).toBe(true);
    expect(isScheduleQuery("do I have something due")).toBe(true);
  });

  it("matches 'anything planned/scheduled/going on'", () => {
    expect(isScheduleQuery("anything planned for today")).toBe(true);
    expect(isScheduleQuery("anything scheduled today")).toBe(true);
    expect(isScheduleQuery("anything going on today")).toBe(true);
  });

  it("matches via keyword fallback", () => {
    expect(isScheduleQuery("my schedule")).toBe(true);
    expect(isScheduleQuery("my agenda")).toBe(true);
  });

  it("matches via 'today' with context words", () => {
    expect(isScheduleQuery("what's on my schedule today")).toBe(true);
    expect(isScheduleQuery("tell me what is due")).toBe(true);
    expect(isScheduleQuery("anything happening today")).toBe(true);
  });

  it("does NOT match task creation", () => {
    expect(isScheduleQuery("task buy groceries")).toBe(false);
    expect(isScheduleQuery("task buy milk by tomorrow")).toBe(false);
  });

  it("does NOT match reminder creation", () => {
    expect(isScheduleQuery("remind me to call mom")).toBe(false);
    expect(isScheduleQuery("remind me meeting at 3pm")).toBe(false);
    expect(isScheduleQuery("remind me about dinner in 2h")).toBe(false);
  });

  it("does NOT match note creation", () => {
    expect(isScheduleQuery("note meeting notes | discussed budget")).toBe(false);
    expect(isScheduleQuery("note hello world")).toBe(false);
  });

  it("does NOT match alarm", () => {
    expect(isScheduleQuery("alarm wake me up in 10m")).toBe(false);
    expect(isScheduleQuery("alarm test in 5 minutes")).toBe(false);
  });

  it("does NOT match unrelated phrases", () => {
    expect(isScheduleQuery("hello")).toBe(false);
    expect(isScheduleQuery("thanks")).toBe(false);
    expect(isScheduleQuery("yes")).toBe(false);
    expect(isScheduleQuery("not now")).toBe(false);
    expect(isScheduleQuery("i am john your boss")).toBe(false);
    expect(isScheduleQuery("who is your boss")).toBe(false);
  });
});
