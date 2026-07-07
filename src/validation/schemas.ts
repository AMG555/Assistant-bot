import { z } from "zod";
import { isValidTimeZone } from "../lib/timezone.js";

/**
 * SERVER-SIDE VALIDATION LAYER
 * ---------------------------------------------------------------------
 * Bots have no "frontend form" in the traditional sense, but chat input
 * is exactly as untrusted as a public HTML form — arguably more so,
 * since it's raw user-typed text. Every command handler MUST parse its
 * input through one of these schemas before it touches the database.
 * Never trust platform-side "slash command option types" alone.
 */

export const createNoteSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().max(4000).default(""),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  dueAt: z.coerce.date().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const createReminderSchema = z.object({
  message: z.string().trim().min(1, "Reminder text is required").max(500),
  remindAt: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now(), "Reminder time must be in the future"),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  isAlarm: z.boolean().optional().default(false),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const setTimezoneSchema = z.object({
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((tz) => isValidTimeZone(tz), "Not a recognized timezone (use an IANA name, e.g. Asia/Kolkata)"),
});

export const linkCodeRequestSchema = z.object({
  accountId: z.string().uuid(),
});

export const linkCodeConsumeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{6,10}$/, "Invalid code format"),
  platform: z.enum(["telegram", "discord", "whatsapp"]),
  platformUserId: z.string().trim().min(1).max(128),
  displayName: z.string().trim().max(120).optional(),
});

export const chartRequestSchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
  kind: z.enum(["tasks", "notes", "reminders", "all"]).default("all"),
});

export const setDigestSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23).optional(),
});

export const snoozeReminderSchema = z.object({
  idPrefix: z
    .string()
    .trim()
    .min(3, "Reminder id is too short")
    .max(64),
  delayMs: z.number().int().positive("Snooze duration must be positive"),
});

/** Small helper: parses input, returns a discriminated result instead
 * of throwing, so call sites never need a try/catch just for validation
 * — only for actual I/O. */
export function safeValidate<T extends z.ZodTypeAny>(schema: T, data: unknown) {
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      ok: false as const,
      error: result.error.issues.map((i) => i.message).join("; "),
    };
  }
  return { ok: true as const, data: result.data as z.infer<T> };
}
