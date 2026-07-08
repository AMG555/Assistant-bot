import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { computeNextOccurrence, type RecurrenceRule } from "../lib/parseWhen.js";
import type { CreateReminderInput } from "../validation/schemas.js";
import type { ServiceResult } from "./accountService.js";

export interface DueReminder {
  id: string;
  accountId: string;
  message: string;
  remindAt: string;
  deliveryAttempts: number;
  recurrenceRule: RecurrenceRule;
  isAlarm: boolean;
}

export async function createReminder(
  accountId: string,
  input: CreateReminderInput
): Promise<ServiceResult<{ id: string }>> {
  try {
    const insertFields: Record<string, unknown> = {
      account_id: accountId,
      message: input.message,
      remind_at: input.remindAt.toISOString(),
      recurrence_rule: input.recurrence,
    };
    if (input.isAlarm) insertFields.is_alarm = true;

    const { data, error } = await supabaseAdmin
      .from("reminders")
      .insert(insertFields)
      .select("id")
      .single();
    if (error) throw error;

    void supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "reminder_created" });

    return { ok: true, data: { id: data.id } };
  } catch (err) {
    logError("createReminder", err, { accountId });
    return { ok: false, error: "Could not schedule reminder right now", code: "internal" };
  }
}

const MAX_DELIVERY_ATTEMPTS = 3;
const ALARM_REDELIVER_INTERVAL_MS = 5 * 60 * 1000;

/** Called only by the internal cron dispatch route — never by a bot
 * command directly. Pulls all reminders whose time has passed and are
 * still pending, using a small attempt cap so a permanently-broken
 * delivery target doesn't retry forever. Also returns alarm reminders
 * (is_alarm = true) whose last delivery was more than 5 minutes ago,
 * so they keep firing until acknowledged. */
export async function fetchDueReminders(limit = 50): Promise<ServiceResult<DueReminder[]>> {
  try {
    const fiveMinAgo = new Date(Date.now() - ALARM_REDELIVER_INTERVAL_MS).toISOString();
    const { data, error } = await supabaseAdmin
      .from("reminders")
      .select("id, account_id, message, remind_at, delivery_attempts, recurrence_rule, is_alarm")
      .eq("status", "pending")
      .or(
        `and(remind_at.lte.${new Date().toISOString()},delivery_attempts.lt.${MAX_DELIVERY_ATTEMPTS}),` +
        `and(is_alarm.eq.true,remind_at.lte.${new Date().toISOString()},or(last_alarm_sent_at.is.null,last_alarm_sent_at.lte.${fiveMinAgo}))`
      )
      .limit(limit);
    if (error) {
      // If the is_alarm column doesn't exist (migration not run), fall
      // back to fetching only normal (non-alarm) due reminders.
      if (error.message?.includes("does not exist")) {
        return fetchDueRemindersSimple(limit);
      }
      throw error;
    }

    return {
      ok: true,
      data: (data ?? []).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        message: r.message,
        remindAt: r.remind_at,
        deliveryAttempts: r.delivery_attempts,
        recurrenceRule: (r.recurrence_rule ?? "none") as RecurrenceRule,
        isAlarm: r.is_alarm ?? false,
      })),
    };
  } catch (err) {
    logError("fetchDueReminders", err);
    return { ok: false, error: "Could not fetch due reminders", code: "internal" };
  }
}

async function fetchDueRemindersSimple(limit: number): Promise<ServiceResult<DueReminder[]>> {
  const { data, error } = await supabaseAdmin
    .from("reminders")
    .select("id, account_id, message, remind_at, delivery_attempts, recurrence_rule")
    .eq("status", "pending")
    .lte("remind_at", new Date().toISOString())
    .lt("delivery_attempts", MAX_DELIVERY_ATTEMPTS)
    .limit(limit);
  if (error) throw error;

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      message: r.message,
      remindAt: r.remind_at,
      deliveryAttempts: r.delivery_attempts,
      recurrenceRule: (r.recurrence_rule ?? "none") as RecurrenceRule,
      isAlarm: false,
    })),
  };
}

/** Marks a reminder as sent, and — if it has a recurrence rule — inserts
 * the next occurrence as a brand-new pending row. This runs only after
 * a successful delivery, so a broken/undeliverable recurring reminder
 * doesn't quietly keep spawning future copies of itself forever; it
 * will instead exhaust MAX_DELIVERY_ATTEMPTS and land in 'failed',
 * which is surfaced rather than hidden. */
export async function markReminderSent(
  reminderId: string,
  accountId: string,
  message: string,
  recurrenceRule: RecurrenceRule,
  remindAtIso: string
): Promise<void> {
  try {
    await supabaseAdmin.from("reminders").update({ status: "sent" }).eq("id", reminderId);
    void supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "reminder_sent" });

    const next = computeNextOccurrence(recurrenceRule, new Date(remindAtIso));
    if (next) {
      const { error } = await supabaseAdmin.from("reminders").insert({
        account_id: accountId,
        message,
        remind_at: next.toISOString(),
        recurrence_rule: recurrenceRule,
      });
      if (error) {
        logError("markReminderSent.recurrence", error, { reminderId, message });
      }
    }
  } catch (err) {
    logError("markReminderSent", err, { reminderId });
  }
}

export async function listPendingReminders(
  accountId: string,
  limit = 15
): Promise<ServiceResult<Array<{ id: string; message: string; remindAt: string; recurrenceRule: RecurrenceRule }>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("reminders")
      .select("id, message, remind_at, recurrence_rule")
      .eq("account_id", accountId)
      .eq("status", "pending")
      .order("remind_at", { ascending: true })
      .limit(limit);
    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((r) => ({
        id: r.id,
        message: r.message,
        remindAt: r.remind_at,
        recurrenceRule: (r.recurrence_rule ?? "none") as RecurrenceRule,
      })),
    };
  } catch (err) {
    logError("listPendingReminders", err, { accountId });
    return { ok: false, error: "Could not load reminders right now", code: "internal" };
  }
}

/** Pushes a pending reminder's remind_at forward by `delayMs`, scoped by
 * account_id so an id belonging to another account can never be
 * snoozed even if guessed. Returns the previous remind_at as well, so
 * callers can build an undo action that restores the exact prior time. */
export async function snoozeReminder(
  accountId: string,
  reminderId: string,
  delayMs: number
): Promise<ServiceResult<{ previousRemindAt: string; newRemindAt: string }>> {
  try {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("reminders")
      .select("remind_at, status")
      .eq("id", reminderId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return { ok: false, error: "Reminder not found", code: "not_found" };
    if (existing.status !== "pending") {
      return { ok: false, error: "Only pending reminders can be snoozed", code: "conflict" };
    }

    const newRemindAt = new Date(Date.now() + delayMs).toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("reminders")
      .update({ remind_at: newRemindAt })
      .eq("id", reminderId)
      .eq("account_id", accountId);
    if (updateError) throw updateError;

    return { ok: true, data: { previousRemindAt: existing.remind_at, newRemindAt } };
  } catch (err) {
    logError("snoozeReminder", err, { accountId, reminderId });
    return { ok: false, error: "Could not snooze reminder right now", code: "internal" };
  }
}

/** Restores a reminder's remind_at to a specific prior value — used only
 * by the undo mechanism to revert a snooze. Scoped by account_id, same
 * ownership discipline as every other mutation in this file. */
export async function restoreReminderTime(
  accountId: string,
  reminderId: string,
  remindAtIso: string
): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin
      .from("reminders")
      .update({ remind_at: remindAtIso })
      .eq("id", reminderId)
      .eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("restoreReminderTime", err, { accountId, reminderId });
    return { ok: false, error: "Could not undo that right now", code: "internal" };
  }
}

/** Deletes a reminder outright — used only by the undo mechanism to
 * revert a `remind me ...` creation. Scoped by account_id. */
export async function deleteReminder(accountId: string, reminderId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin.from("reminders").delete().eq("id", reminderId).eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("deleteReminder", err, { accountId, reminderId });
    return { ok: false, error: "Could not undo that right now", code: "internal" };
  }
}

export async function markReminderFailedAttempt(reminderId: string, attempts: number, errorMessage: string): Promise<void> {
  try {
    const nextAttempts = attempts + 1;
    await supabaseAdmin
      .from("reminders")
      .update({
        delivery_attempts: nextAttempts,
        status: nextAttempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "pending",
        last_error: errorMessage.slice(0, 500),
      })
      .eq("id", reminderId);
  } catch (err) {
    logError("markReminderFailedAttempt", err, { reminderId });
  }
}

/** Records a successful alarm delivery so the cron dispatcher knows not
 * to re-send it immediately (uses last_alarm_sent_at as a cooldown). */
export async function markAlarmDelivered(reminderId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("reminders")
      .update({ last_alarm_sent_at: new Date().toISOString() })
      .eq("id", reminderId);
  } catch (err) {
    logError("markAlarmDelivered", err, { reminderId });
  }
}

/** Acknowledges an alarm reminder, marking it as sent so it stops
 * re-delivering. Scoped by account_id. */
export async function acknowledgeReminder(accountId: string, reminderId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin
      .from("reminders")
      .update({ status: "sent", delivery_attempts: 0 })
      .eq("id", reminderId)
      .eq("account_id", accountId)
      .eq("is_alarm", true);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("acknowledgeReminder", err, { accountId, reminderId });
    return { ok: false, error: "Could not acknowledge that alarm", code: "internal" };
  }
}
