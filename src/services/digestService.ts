import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { getLocalHourAndDateKey } from "../lib/timezone.js";
import type { ServiceResult } from "./accountService.js";

export interface DigestAccount {
  accountId: string;
  timezone: string;
}

/** Returns accounts whose local time currently matches their chosen
 * digest hour AND haven't received today's digest yet. The comparison
 * itself runs inside Postgres (see accounts_due_for_digest in
 * schema.sql) so this is a single indexed query, not an N-account scan
 * with per-account timezone math in application code. */
export async function fetchAccountsDueForDigest(): Promise<ServiceResult<DigestAccount[]>> {
  try {
    const { data, error } = await supabaseAdmin.rpc("accounts_due_for_digest");
    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row: { account_id: string; timezone: string }) => ({
        accountId: row.account_id,
        timezone: row.timezone,
      })),
    };
  } catch (err) {
    logError("fetchAccountsDueForDigest", err);
    return { ok: false, error: "Could not fetch digest-eligible accounts", code: "internal" };
  }
}

/** Marks today (in the account's own timezone) as having been sent,
 * so the next cron tick within the same local day doesn't re-send. */
export async function markDigestSentToday(accountId: string, timeZone: string): Promise<void> {
  try {
    const { dateKey } = getLocalHourAndDateKey(timeZone);
    await supabaseAdmin.from("accounts").update({ last_digest_sent_date: dateKey }).eq("id", accountId);
  } catch (err) {
    logError("markDigestSentToday", err, { accountId });
  }
}

export interface DigestContent {
  tasksDueTodayOrOverdue: Array<{ title: string; dueAt: string | null; overdue: boolean }>;
  remindersToday: Array<{ message: string; remindAt: string }>;
  recentNotes: Array<{ title: string }>;
}

/** Builds the actual digest content for one account, scoped by
 * account_id on every query — same isolation discipline as every other
 * service in this codebase, just composed from three tables instead of
 * one. Returns an "empty but ok" result rather than an error when there
 * is genuinely nothing to report, so the caller can send a short
 * positive message instead of treating "nothing due" as a failure. */
export async function buildDigestContent(accountId: string, timeZone: string): Promise<ServiceResult<DigestContent>> {
  try {
    const { dateKey } = getLocalHourAndDateKey(timeZone);
    const startOfTodayUtcIso = new Date(`${dateKey}T00:00:00.000Z`).toISOString();
    const endOfTodayUtcIso = new Date(`${dateKey}T23:59:59.999Z`).toISOString();
    const nowIso = new Date().toISOString();

    const [tasksResult, remindersResult, notesResult] = await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("title, due_at")
        .eq("account_id", accountId)
        .is("completed_at", null)
        .lte("due_at", endOfTodayUtcIso)
        .not("due_at", "is", null)
        .order("due_at", { ascending: true })
        .limit(20),
      supabaseAdmin
        .from("reminders")
        .select("message, remind_at")
        .eq("account_id", accountId)
        .eq("status", "pending")
        .gt("remind_at", nowIso)
        .lte("remind_at", endOfTodayUtcIso)
        .order("remind_at", { ascending: true })
        .limit(20),
      supabaseAdmin
        .from("notes")
        .select("title")
        .eq("account_id", accountId)
        .gte("created_at", startOfTodayUtcIso)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    if (tasksResult.error) throw tasksResult.error;
    if (remindersResult.error) throw remindersResult.error;
    if (notesResult.error) throw notesResult.error;

    const tasksDueTodayOrOverdue = (tasksResult.data ?? []).map((t) => ({
      title: t.title,
      dueAt: t.due_at,
      overdue: Boolean(t.due_at && t.due_at < nowIso),
    }));

    return {
      ok: true,
      data: {
        tasksDueTodayOrOverdue,
        remindersToday: (remindersResult.data ?? []).map((r) => ({ message: r.message, remindAt: r.remind_at })),
        recentNotes: (notesResult.data ?? []).map((n) => ({ title: n.title })),
      },
    };
  } catch (err) {
    logError("buildDigestContent", err, { accountId });
    return { ok: false, error: "Could not build digest content", code: "internal" };
  }
}

/** Renders digest content into a single plain-text message. Kept
 * separate from buildDigestContent so the data-shaping and the
 * presentation formatting can be tested/changed independently. */
export function formatDigestMessage(content: DigestContent): string {
  const lines: string[] = ["☀ Your daily digest"];

  if (content.tasksDueTodayOrOverdue.length > 0) {
    lines.push("", "Tasks due today or overdue:");
    for (const t of content.tasksDueTodayOrOverdue) {
      lines.push(`• ${t.title}${t.overdue ? " (overdue)" : ""}`);
    }
  }

  if (content.remindersToday.length > 0) {
    lines.push("", "Reminders scheduled today:");
    for (const r of content.remindersToday) {
      lines.push(`• ${r.message} at ${r.remindAt}`);
    }
  }

  if (content.recentNotes.length > 0) {
    lines.push("", "Notes you added today:");
    for (const n of content.recentNotes) {
      lines.push(`• ${n.title}`);
    }
  }

  const hasAnyContent =
    content.tasksDueTodayOrOverdue.length > 0 || content.remindersToday.length > 0 || content.recentNotes.length > 0;

  if (!hasAnyContent) {
    lines.push("", "Nothing due today and no new notes. You're all caught up!");
  }

  return lines.join("\n");
}
