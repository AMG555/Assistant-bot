import {
  resolveOrCreateAccount,
  issueLinkCode,
  consumeLinkCode,
  isAiEnabledForAccount,
  setAiEnabledForAccount,
  getAccountTimeZone,
  setAccountTimeZone,
  setDigestEnabled,
  getOrCreateWebhookSecret,
  setOutgoingWebhookUrl,
  type Platform,
} from "../services/accountService.js";
import { createNote, listRecentNotes, deleteNote } from "../services/notesService.js";
import { createTask, completeTask, listOpenTasks, deleteTask, uncompleteTask } from "../services/tasksService.js";
import {
  createReminder,
  listPendingReminders,
  snoozeReminder,
  restoreReminderTime,
  deleteReminder,
  acknowledgeReminder,
} from "../services/remindersService.js";
import { renderActivityChart } from "../services/chartService.js";
import { issueOAuthState, getNotionConnection, setNotionDatabaseId, disconnectNotion } from "../services/notionConnectionService.js";
import { buildNotionAuthorizeUrl } from "../services/notionClient.js";
import { pushNoteToNotion } from "../services/notionSyncService.js";
import { embedNoteInBackground } from "../services/embeddingSyncService.js";
import { buildDigestContent } from "../services/digestService.js";
import {
  createNoteSchema,
  createTaskSchema,
  createReminderSchema,
  linkCodeConsumeSchema,
  chartRequestSchema,
  setTimezoneSchema,
  setDigestSchema,
  snoozeReminderSchema,
  safeValidate,
} from "../validation/schemas.js";
import { parseWhen, extractRecurrence, parseHourOfDay, parseRelativeDurationMs } from "../lib/parseWhen.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { recordUndoableAction, takeUndoableAction } from "../lib/undoStore.js";
import { recordExchange, getConversationHistory, countExchanges } from "../lib/conversationMemory.js";
import { logError, logger } from "../lib/logger.js";
import { isGroqConfigured, isNotionConfigured, isSemanticSearchConfigured, env } from "../config/env.js";
import { interpretMessage, answerQuestionWithRag, type AiIntent } from "../services/aiService.js";
import { retrieveRelevantNotes } from "../services/ragService.js";
import { maybeSummarizeOldConversation } from "../services/conversationSummaryService.js";

/**
 * A platform-agnostic reply: adapters translate this into whatever
 * their SDK needs (Telegram sendMessage, Discord interaction response,
 * WhatsApp message send). Keeping this shape simple means adding a
 * fourth platform later never touches business logic.
 */
export type BotReply =
  | { kind: "text"; text: string }
  | { kind: "image"; caption: string; buffer: Buffer };

export interface IncomingCommand {
  platform: Platform;
  platformUserId: string;
  displayName?: string;
  text: string;
  /** Optional pre-resolved account id. Callers that already resolved
   * the account for a prior step in the same request (e.g. the voice
   * transcription path, which must resolve the account early to check
   * the AI opt-in gate before transcribing) can pass it here to avoid a
   * second redundant Supabase round-trip. When omitted, handleCommand
   * resolves it itself exactly as before. */
  resolvedAccountId?: string;
}

const HELP_TEXT = [
  "Hey! I'm your assistant. I keep notes, track tasks, and send reminders across Telegram and more.",
  "",
  "Try one of these to get started:",
  "  note Buy groceries | milk, eggs, bread",
  "  task Finish report by tomorrow",
  "  remind me call dentist in 2h",
  "",
  "📝  Notes",
  "  note <title> | <body> — save a note",
  "  notes — show your recent notes",
  "",
  "✅  Tasks",
  "  task <title> [by <when>] — add a task",
  "  tasks — list open tasks",
  "  done <task-id> — mark a task complete",
  "",
  "⏰  Reminders",
  "  remind me <msg> in <10m|2h|1d> — one-time reminder",
  "  remind me <msg> at <9am> [every day|week|month] — clock-time reminder, optionally recurring",
  "  alarm <msg> in <10m|2h> — important reminder, re-sent every 5min until acknowledged",
  "  acknowledge <id> — stop an alarm from repeating",
  "  reminders — list pending reminders",
  "  snooze <id> <10m|2h|1d> — push a reminder back",
  "",
  "⚙️  Settings",
  "  timezone <Asia/Kolkata> — set your timezone so reminders land correctly",
  "  undo — revert your last action (works for a few minutes)",
  "  link — get a code to connect another platform to this account",
  "  connect <code> — merge accounts from another platform",
  "  webhook link — get a URL to push data from external services (n8n, IFTTT, etc.)",
  "  webhook out <url> — POST proactive messages (reminders, digests) to an external service",
  "  webhook out off — stop sending outgoing webhooks",
  "",
  "📊  Activity",
  "  schedule / today / my day — see what's on your schedule",
  "  chart [7d|30d] [tasks|notes|reminders] — see your activity",
  "",
  "🤖  AI Features",
  "  ai on / ai off — turn AI on or off (on by default)",
  "  ask <question> — search your notes using AI",
  "  send a voice message — works like typed text",
  "",
  "📰  Daily Digest",
  "  digest on [at <8am>] / digest off — get a daily summary",
  "",
  "🔗  Notion Sync (opt-in)",
  "  notion connect — link your Notion workspace",
  "  notion database <id> — choose which database to sync",
  "  notion status — check your connection",
  "  notion disconnect — stop syncing",
].join("\n");

const WELCOME_TEXT = "Hey! I'm your assistant. You can chat with me naturally — I understand plain English. Try \"remind me to call mom tomorrow\", \"note grocery list\", or just say hi. Send /help anytime to see what I can do.";

function friendlyTime(iso: string, tz?: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const abs = Math.abs(diffMs);
    const isPast = diffMs < 0;

    if (abs < 60000) return isPast ? "just now" : "in less than a minute";
    if (abs < 3600000) {
      const m = Math.round(abs / 60000);
      return isPast ? `${m}m ago` : `in ${m}m`;
    }
    if (abs < 86400000) {
      const h = Math.round(abs / 3600000);
      return isPast ? `${h}h ago` : `in ${h}h`;
    }
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
  } catch {
    return iso;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export async function handleCommand(cmd: IncomingCommand): Promise<BotReply> {
  let accountId = cmd.resolvedAccountId;
  if (!accountId) {
    const accountResult = await resolveOrCreateAccount(cmd.platform, cmd.platformUserId, cmd.displayName);
    if (!accountResult.ok) {
      return { kind: "text", text: "Sorry, I hit a snag. Try again in a moment." };
    }
    accountId = accountResult.data.accountId;
  }
  const text = cmd.text.trim();
  const lower = text.toLowerCase();

  try {
    if (lower === "/start" || lower === "help" || lower === "/help") {
      if (lower === "/start") {
        return { kind: "text", text: WELCOME_TEXT };
      }
      return { kind: "text", text: HELP_TEXT };
    }

    if (lower.startsWith("note ")) {
      const raw = text.slice(5);
      const [titlePart, ...bodyParts] = raw.split("|");
      const validation = safeValidate(createNoteSchema, {
        title: titlePart?.trim() ?? "",
        body: bodyParts.join("|").trim(),
        tags: [],
      });
      if (!validation.ok) return { kind: "text", text: `Hmm, couldn't save that note: ${validation.error}` };

      const result = await createNote(accountId, validation.data);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      recordUndoableAction(accountId, { kind: "delete_note", noteId: result.data.id });
      // Fire-and-forget: pushing to Notion is a best-effort side effect
      // and must never block or fail the actual note save, which is
      // the primary action the user asked for. Errors are logged inside
      // pushNoteToNotion itself, never thrown here.
      void pushNoteToNotion(accountId, result.data.id);

      // Embedding a note sends its content to a third party (Jina) —
      // exactly as privacy-sensitive as the Groq-based AI features, so
      // it's gated behind the SAME "ai on" opt-in, not just the
      // server-level isSemanticSearchConfigured flag. A user who never
      // opted into AI features must never have their notes silently
      // sent anywhere just because the operator configured a Jina key.
      if (isSemanticSearchConfigured) {
        isAiEnabledForAccount(accountId).then((enabled) => {
          if (enabled) embedNoteInBackground(accountId, result.data.id).catch(() => {});
        }).catch(() => {});
      }

      return { kind: "text", text: 'Saved your note! Send "undo" within a few minutes to remove it.' };
    }

    if (lower === "notes") {
      const result = await listRecentNotes(accountId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      if (result.data.length === 0) return { kind: "text", text: "You haven't saved any notes yet. Try: note <title> | <body>" };
      return {
        kind: "text",
        text: result.data.map((n) => `• ${n.title}`).join("\n"),
      };
    }

    if (lower.startsWith("timezone ")) {
      const tz = text.slice(9).trim();
      const validation = safeValidate(setTimezoneSchema, { timeZone: tz });
      if (!validation.ok) return { kind: "text", text: `⚠ ${validation.error}` };

      const result = await setAccountTimeZone(accountId, validation.data.timeZone);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: `Got it! Your timezone is now ${validation.data.timeZone}.`       };
    }

    if (lower === "digest off") {
      const result = await setDigestEnabled(accountId, false);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: "Alright, daily digest is off." };
    }

    if (lower.startsWith("digest on")) {
      const atMatch = text.match(/\bat\s+(.+)$/i);
      let hour: number | undefined;
      if (atMatch) {
        const parsedHour = parseHourOfDay(atMatch[1]!.trim());
        if (parsedHour === null) {
          return { kind: "text", text: "I couldn't understand that hour. Try: digest on at 8am" };
        }
        hour = parsedHour;
      }

      const validation = safeValidate(setDigestSchema, { enabled: true, hour });
      if (!validation.ok) return { kind: "text", text: `⚠ ${validation.error}` };

      const result = await setDigestEnabled(accountId, true, validation.data.hour);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };

      const tz = await getAccountTimeZone(accountId);
      const hourLabel = validation.data.hour !== undefined ? `${validation.data.hour}:00` : "8:00 (default)";
      return {
        kind: "text",
        text: `Daily digest turned on — you'll get a summary around ${hourLabel} in your timezone (${tz}). It's delivered via Telegram/WhatsApp.`,
      };
    }

    if (lower.startsWith("task ")) {
      const raw = text.slice(5);
      const byMatch = raw.match(/\bby\s+(.+)$/i);
      const title = byMatch ? raw.slice(0, byMatch.index).trim() : raw.trim();
      let dueAt: Date | undefined;

      if (byMatch) {
        const parsed = parseWhen(byMatch[1]!.trim(), await getAccountTimeZone(accountId));
        if (parsed) dueAt = parsed;
        // if byMatch found but parse failed, fall through to NL
      }

      // Don't create a spurious task if the user is asking about their schedule
      const taskTitleLower = title.toLowerCase();
      const isScheduleQuery = !byMatch && (["schedule", "agenda"].some((k) => taskTitleLower.includes(k)) || (taskTitleLower.includes("today") && ["have", "on", "due", "plan", "my", "what", "show", "tell", "about", "for", "anything", "upcoming", "going", "happening"].some((w) => taskTitleLower.includes(w))));

      if (!isScheduleQuery && title && (dueAt !== undefined || !byMatch)) {
        const validation = safeValidate(createTaskSchema, {
          title,
          dueAt,
          priority: "normal",
        });
        if (!validation.ok) return { kind: "text", text: `Hmm, couldn't save that task: ${validation.error}` };

        const result = await createTask(accountId, validation.data);
        if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
        recordUndoableAction(accountId, { kind: "delete_task", taskId: result.data.id });
        return { kind: "text", text: 'Task added! Send "undo" within a few minutes to remove it.' };
      }
      // parsing failed — fall through to NL
    }

    if (lower === "tasks") {
      const result = await listOpenTasks(accountId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      if (result.data.length === 0) return { kind: "text", text: "No open tasks — you're all caught up! 🎉" };
      const now = await getAccountTimeZone(accountId);
      return {
        kind: "text",
        text: result.data
          .map((t) => `• ${shortId(t.id)} ${t.title}${t.dueAt ? ` (due ${friendlyTime(t.dueAt, now)})` : ""}`)
          .join("\n"),
      };
    }

    if (lower.startsWith("done ")) {
      const idPrefix = text.slice(5).trim();
      if (!idPrefix) return { kind: "text", text: "You'll need the task id. Try: done a1b2c3d4 — use 'tasks' to see the list." };
      // We only stored an 8-char prefix in the UI; resolve via prefix match.
      const openTasks = await listOpenTasks(accountId, 50);
      if (!openTasks.ok) return { kind: "text", text: `⚠ ${openTasks.error}` };
      const match = openTasks.data.find((t) => t.id.startsWith(idPrefix));
      if (!match) return { kind: "text", text: "Hmm, couldn't find an open task with that id. Use 'tasks' to see them all." };

      const result = await completeTask(accountId, match.id);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      recordUndoableAction(accountId, { kind: "uncomplete_task", taskId: match.id });
      return { kind: "text", text: `Done! "${match.title}" marked complete. Nice work. Send "undo" to reopen it.` };
    }

    if (lower.startsWith("remind me ")) {
      const rawFull = text.slice("remind me ".length);
      const { recurrence, remaining } = extractRecurrence(rawFull);

      const inMatch = remaining.match(/\bin\s+(.+)$/i);
      const atMatch = remaining.match(/\bat\s+(.+)$/i);

      let message: string | undefined;
      let when: Date | null | undefined;

      if (inMatch) {
        message = remaining.slice(0, inMatch.index).trim();
        when = parseWhen(`in ${inMatch[1]!.trim()}`);
      } else if (atMatch) {
        message = remaining.slice(0, atMatch.index).trim();
        when = parseWhen(`at ${atMatch[1]!.trim()}`, await getAccountTimeZone(accountId));
      }

      if (when && message) {
        const validation = safeValidate(createReminderSchema, { message, remindAt: when, recurrence });
        if (!validation.ok) return { kind: "text", text: `Hmm, couldn't schedule that: ${validation.error}` };

        const result = await createReminder(accountId, validation.data);
        if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
        recordUndoableAction(accountId, { kind: "delete_reminder", reminderId: result.data.id });

        const recurrenceNote = recurrence === "none" ? "" : ` (repeating ${recurrence})`;
        return {
          kind: "text",
          text: `Got it! I'll remind you ${friendlyTime(when.toISOString())}${recurrenceNote}. Send "undo" within a few minutes to cancel it.`,
        };
      }
      // parsing failed — fall through to NL
    }

    if (lower.startsWith("alarm ")) {
      const rawFull = text.slice("alarm ".length);
      const inMatch = rawFull.match(/\bin\s+(.+)$/i);
      const atMatch = rawFull.match(/\bat\s+(.+)$/i);

      let message: string | undefined;
      let when: Date | null | undefined;

      if (inMatch) {
        message = rawFull.slice(0, inMatch.index).trim();
        when = parseWhen(`in ${inMatch[1]!.trim()}`);
      } else if (atMatch) {
        message = rawFull.slice(0, atMatch.index).trim();
        when = parseWhen(`at ${atMatch[1]!.trim()}`, await getAccountTimeZone(accountId));
      }

      if (when && message) {
        const validation = safeValidate(createReminderSchema, { message, remindAt: when, recurrence: "none", isAlarm: true });
        if (!validation.ok) return { kind: "text", text: `Hmm, couldn't schedule that: ${validation.error}` };

        const result = await createReminder(accountId, validation.data);
        if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
        recordUndoableAction(accountId, { kind: "delete_reminder", reminderId: result.data.id });

        return {
          kind: "text",
          text: `🔔 Alarm set! I'll ping you ${friendlyTime(when.toISOString())} and keep repeating until you say "acknowledge ${shortId(result.data.id)}".`,
        };
      }
      // parsing failed — fall through to NL
    }

    if (lower.startsWith("acknowledge ")) {
      const idPrefix = text.slice("acknowledge ".length).trim();
      if (!idPrefix) return { kind: "text", text: "You'll need the alarm id. Try: acknowledge a1b2c3d4" };

      const pending = await listPendingReminders(accountId, 50);
      if (!pending.ok) return { kind: "text", text: `⚠ ${pending.error}` };
      const match = pending.data.find((r) => r.id.startsWith(idPrefix));
      if (!match) return { kind: "text", text: "Hmm, I don't see an alarm with that id." };

      const result = await acknowledgeReminder(accountId, match.id);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: "Alarm acknowledged. It won't repeat anymore." };
    }

    if (lower === "reminders") {
      const result = await listPendingReminders(accountId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      if (result.data.length === 0) return { kind: "text", text: "No pending reminders right now." };
      return {
        kind: "text",
        text: result.data
          .map((r) => `• ${shortId(r.id)} ${r.message} ${friendlyTime(r.remindAt)}${r.recurrenceRule !== "none" ? ` (${r.recurrenceRule})` : ""}`)
          .join("\n"),
      };
    }

    if (lower.startsWith("snooze ")) {
      const rest = text.slice(7).trim();
      const parts = rest.split(/\s+/);
      const idPrefix = parts[0] ?? "";
      const durationText = parts.slice(1).join(" ");

      const durationMs = parseRelativeDurationMs(durationText);
      const validation = safeValidate(snoozeReminderSchema, { idPrefix, delayMs: durationMs ?? -1 });
      if (validation.ok && durationMs !== null) {
        const pending = await listPendingReminders(accountId, 50);
        if (!pending.ok) return { kind: "text", text: `⚠ ${pending.error}` };
        const match = pending.data.find((r) => r.id.startsWith(validation.data.idPrefix));
        if (match) {
          const result = await snoozeReminder(accountId, match.id, validation.data.delayMs);
          if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };

          recordUndoableAction(accountId, {
            kind: "restore_reminder_time",
            reminderId: match.id,
            previousRemindAt: result.data.previousRemindAt,
          });
          return { kind: "text", text: `Snoozed — now set for ${friendlyTime(result.data.newRemindAt)}. Send "undo" to revert.` };
        }
      }
      // parsing failed or no match — fall through to NL
    }

    if (lower === "undo") {
      const action = takeUndoableAction(accountId);
      if (!action) return { kind: "text", text: "Nothing to undo right now. Create a note, task, or reminder first." };

      switch (action.kind) {
        case "delete_note": {
          const result = await deleteNote(accountId, action.noteId);
          if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
          return { kind: "text", text: "Taken care of — that note is gone." };
        }
        case "delete_task": {
          const result = await deleteTask(accountId, action.taskId);
          if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
          return { kind: "text", text: "Taken care of — that task is removed." };
        }
        case "delete_reminder": {
          const result = await deleteReminder(accountId, action.reminderId);
          if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
          return { kind: "text", text: "Taken care of — that reminder is cancelled." };
        }
        case "uncomplete_task": {
          const result = await uncompleteTask(accountId, action.taskId);
          if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
          return { kind: "text", text: "Done — that task is back open." };
        }
        case "restore_reminder_time": {
          const result = await restoreReminderTime(accountId, action.reminderId, action.previousRemindAt);
          if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
          return { kind: "text", text: `Undone — reminder restored to ${friendlyTime(action.previousRemindAt)}.` };
        }
        default:
          return { kind: "text", text: "Nothing to undo right now." };
      }
    }

    if (lower.startsWith("chart")) {
      const parts = lower.split(/\s+/).slice(1);
      const validation = safeValidate(chartRequestSchema, {
        range: parts.find((p) => p === "7d" || p === "30d") ?? "7d",
        kind: parts.find((p) => ["tasks", "notes", "reminders", "all"].includes(p)) ?? "all",
      });
      if (!validation.ok) return { kind: "text", text: `⚠ ${validation.error}` };

      const result = await renderActivityChart(accountId, validation.data.range, validation.data.kind);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "image", caption: `Your activity — last ${validation.data.range}`, buffer: result.data };
    }

    if (lower === "link") {
      if (!checkRateLimit(`link-code:${accountId}`, 3, 60 * 60 * 1000)) {
        return { kind: "text", text: "You've requested too many link codes. Try again in an hour." };
      }
      const result = await issueLinkCode(accountId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return {
        kind: "text",
        text: `Your link code is ${result.data.code} (expires in a few minutes). On your other platform, send: connect ${result.data.code}`,
      };
    }

    if (lower.startsWith("connect ")) {
      const code = text.slice(8).trim().toUpperCase();
      const validation = safeValidate(linkCodeConsumeSchema, {
        code,
        platform: cmd.platform,
        platformUserId: cmd.platformUserId,
        displayName: cmd.displayName,
      });
      if (!validation.ok) return { kind: "text", text: `⚠ ${validation.error}` };

      const result = await consumeLinkCode(
        validation.data.code,
        validation.data.platform,
        validation.data.platformUserId,
        validation.data.displayName
      );
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: "You're all set! Both platforms now share the same notes, tasks, and reminders." };
    }

    if (lower === "webhook link") {
      const result = await getOrCreateWebhookSecret(accountId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return {
        kind: "text",
        text: `Your webhook inbox is ready.\n\nPOST to this URL with an X-Webhook-Secret header:\n${result.data.url}\n\nYour secret:\n${result.data.secret}\n\nExample:\ncurl -X POST "${result.data.url}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Webhook-Secret: ${result.data.secret}" \\\n  -d '{"text":"buy milk","source":"n8n"}'`,
      };
    }

    if (lower.startsWith("webhook out ")) {
      const url = text.slice("webhook out ".length).trim();
      if (!url || url === "off") {
        const result = await setOutgoingWebhookUrl(accountId, null);
        if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
        return { kind: "text", text: "Outgoing webhook cleared. I won't POST proactive messages anywhere." };
      }
      try { new URL(url); } catch {
        return { kind: "text", text: "That doesn't look like a valid URL. Try: webhook out https://example.com/hook" };
      }
      const result = await setOutgoingWebhookUrl(accountId, url);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: `Got it! I'll POST proactive messages (reminders, digests) to:\n${url}` };
    }

    if (lower === "ai on") {
      if (!isGroqConfigured) {
        return { kind: "text", text: "Sorry, the AI features haven't been set up yet. Check back later." };
      }
      const result = await setAiEnabledForAccount(accountId, true);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return {
        kind: "text",
        text: "AI is now ON. I'll use it to help understand you better. Send \"ai off\" anytime to turn it off.",
      };
    }

    if (lower === "ai off") {
      const result = await setAiEnabledForAccount(accountId, false);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: "AI is now OFF. Your messages won't be sent to any AI service." };
    }

    if (lower === "notion connect") {
      if (!isNotionConfigured) {
        return { kind: "text", text: "Notion sync isn't configured on this server yet." };
      }
      if (!checkRateLimit(`notion-connect:${accountId}`, 5, 60 * 60 * 1000)) {
        return { kind: "text", text: "You've tried connecting too many times. Try again in an hour." };
      }

      const stateResult = await issueOAuthState(accountId);
      if (!stateResult.ok) return { kind: "text", text: `⚠ ${stateResult.error}` };

      const redirectUri = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/oauth/notion/callback`;
      const url = buildNotionAuthorizeUrl(env.NOTION_OAUTH_CLIENT_ID, redirectUri, stateResult.data.state);

      return {
        kind: "text",
        text: `Open this link to connect your Notion workspace (expires in ${env.LINK_CODE_TTL_MINUTES} minutes):\n${url}\n\nAfter approving, come back and send: notion database <the database id you want to sync to>`,
      };
    }

    if (lower.startsWith("notion database ")) {
      const databaseId = text.slice(17).trim();
      if (!databaseId) return { kind: "text", text: "Try: notion database <database id>" };

      const connectionResult = await getNotionConnection(accountId);
      if (!connectionResult.ok) return { kind: "text", text: `⚠ ${connectionResult.error}` };
      if (!connectionResult.data) {
        return { kind: "text", text: "You haven't connected Notion yet. Send \"notion connect\" to get started." };
      }

      const result = await setNotionDatabaseId(accountId, databaseId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: "Done! New notes will automatically sync to your Notion database." };
    }

    if (lower === "notion status") {
      if (!isNotionConfigured) {
        return { kind: "text", text: "Notion sync isn't configured on this server yet." };
      }
      const connectionResult = await getNotionConnection(accountId);
      if (!connectionResult.ok) return { kind: "text", text: `⚠ ${connectionResult.error}` };
      if (!connectionResult.data) {
        return { kind: "text", text: "You're not connected to Notion yet. Send \"notion connect\" to get started." };
      }
      const c = connectionResult.data;
      return {
        kind: "text",
        text: `Connected to Notion workspace: ${c.workspaceName ?? c.workspaceId}\nDatabase: ${c.databaseId ?? "(not set — send: notion database <id>)"}`,
      };
    }

    if (lower === "notion disconnect") {
      const result = await disconnectNotion(accountId);
      if (!result.ok) return { kind: "text", text: `⚠ ${result.error}` };
      return { kind: "text", text: "Disconnected from Notion. Your notes here are safe." };
    }

    if (lower.startsWith("ask ")) {
      const question = text.slice(4).trim();
      if (!question) return { kind: "text", text: "Try: ask what did I write about the budget?" };

      if (!isGroqConfigured) return { kind: "text", text: "Sorry, the AI features haven't been set up yet." };
      if (!(await isAiEnabledForAccount(accountId))) {
        return { kind: "text", text: "AI is off for your account. Send \"ai on\" to turn it on." };
      }

      await recordExchange(accountId, "user", text);
      const history = (await getConversationHistory(accountId)).slice(0, -1);
      const result = await answerQuestionWithRag(accountId, question, history);
      if (!result.ok) {
        return { kind: "text", text: "Sorry, I couldn't reach the AI service. Try again in a bit." };
      }
      const firstChat = result.intents.find((i) => i.type === "chat");
      if (firstChat && firstChat.type === "chat") {
        await recordExchange(accountId, "assistant", firstChat.text);
        void maybeSummarizeOldConversation(accountId, await countExchanges(accountId));
        return { kind: "text", text: firstChat.text };
      }
      const firstIntent = result.intents[0];
      if (firstIntent?.type === "answer_question") {
        await recordExchange(accountId, "assistant", firstIntent.answer);
        void maybeSummarizeOldConversation(accountId, await countExchanges(accountId));
        return { kind: "text", text: firstIntent.answer };
      }
      return { kind: "text", text: "I don't have enough info in your notes to answer that." };
    }

    const bossMatch = lower.match(/^i\s+am\s+(.+?)(?:\s+your)?\s*boss$/);
    if (bossMatch) {
      const rawName = bossMatch[1]!.trim();
      const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      const noteTitle = `${name} is the boss`;
      const noteResult = await createNote(accountId, { title: noteTitle, body: "", tags: [] });
      if (noteResult.ok) {
        void recordExchange(accountId, "user", text);
        void recordExchange(accountId, "assistant", `Got it, ${name}!`);
        return { kind: "text", text: `Got it, ${name}!` };
      }
    }

    if (lower === "who is your boss" || lower === "whos your boss" || lower === "who's your boss") {
      const notesResult = await listRecentNotes(accountId);
      const bossNote = notesResult.ok && notesResult.data.find((n) => /is the boss/i.test(n.title));
      if (bossNote) {
        const name = bossNote.title.replace(/\s+is the boss/i, "").trim();
        const answer = `You told me — ${name} is the boss!`;
        await recordExchange(accountId, "user", text);
        await recordExchange(accountId, "assistant", answer);
        return { kind: "text", text: answer };
      }
    }

    if (/^(so\s+)?what\s+(do|would|should)\s+(you\s+)?(call|address)\s+me/i.test(lower)) {
      const notesResult = await listRecentNotes(accountId);
      const bossNote = notesResult.ok && notesResult.data.find((n) => /is the boss/i.test(n.title));
      if (bossNote) {
        const name = bossNote.title.replace(/\s+is the boss/i, "").trim();
        const answer = `I call you ${name}!`;
        await recordExchange(accountId, "user", text);
        await recordExchange(accountId, "assistant", answer);
        return { kind: "text", text: answer };
      }
    }

    const schedulePatterns = [
      /^schedule$/i, /^today$/i, /^my day$/i, /^agenda$/i,
      /^(what'?s?|show|tell)\s.*(today|schedule|agenda|on|due|up)/i,
      /^(about|for)\s.*(today|schedule|agenda)/i,
      /what\s.*(have|do|is)\s.*(today|due)/i,
      /todays?\s+schedule/i, /today'?s?\s+(plan|agenda)/i,
      /how'?s?\s+(my|the)\s+day/i,
      /(what'?s?|anything)\s+(on|due)\s+today/i,
      /what'?s?\s+(happening|going\s+on|coming\s+up)/i,
      /plan\s+(for\s+)?today/i,
      /do\s+i\s+have\s+(anything|something)\s+(today|due)/i,
      /anything\s+(planned|scheduled|going\s+on)\s+(for\s+)?today/i,
    ];
    const hasScheduleKeyword = ["schedule", "agenda"].some((k) => lower.includes(k));
    const todayWithContext = lower.includes("today") && ["have", "on", "due", "plan", "my", "what", "show", "tell", "about", "for", "anything", "upcoming", "going", "happening"].some((w) => lower.includes(w));
    if (schedulePatterns.some((p) => p.test(lower)) || hasScheduleKeyword || todayWithContext) {
      const timezone = await getAccountTimeZone(accountId);
      const content = await buildDigestContent(accountId, timezone);
      if (!content.ok) return { kind: "text", text: `⚠ ${content.error}` };
      const lines = ["Here's your schedule for today:"];
      if (content.data.tasksDueTodayOrOverdue.length > 0) {
        lines.push("", "Tasks:");
        for (const t of content.data.tasksDueTodayOrOverdue) {
          lines.push(`• ${t.title}${t.overdue ? " (overdue)" : ""}`);
        }
      }
      if (content.data.remindersToday.length > 0) {
        lines.push("", "Reminders:");
        for (const r of content.data.remindersToday) {
          lines.push(`• ${shortId(r.id)} ${r.message} — ${friendlyTime(r.remindAt, timezone)}`);
        }
        lines.push("", `To remove a past one: acknowledge <id>`);
      }
      if (content.data.recentNotes.length > 0) {
        lines.push("", "Notes added today:");
        for (const n of content.data.recentNotes) {
          lines.push(`• ${n.title}`);
        }
      }
      if (content.data.tasksDueTodayOrOverdue.length === 0 && content.data.remindersToday.length === 0 && content.data.recentNotes.length === 0) {
        lines.push("", "Nothing on today's schedule — you're free!");
      }
      return { kind: "text", text: lines.join("\n") };
    }

    // Natural-language fallback: only reached when no rigid command
    // syntax above matched, and only when the account has explicitly
    // opted in. This never bypasses validation — every intent Groq
    // proposes is re-validated through the same schemas as manual
    // commands before touching the database (see aiService.ts).
    if (isGroqConfigured) {
      const aiEnabled = await isAiEnabledForAccount(accountId);
      if (aiEnabled) {
        await recordExchange(accountId, "user", text);
        const history = (await getConversationHistory(accountId)).slice(0, -1);
        const retrieval = await retrieveRelevantNotes(accountId, text, 5);
        const snippets = retrieval.ok ? retrieval.data.map((n) => `${n.title}: ${n.body}`) : [];
        const timezone = await getAccountTimeZone(accountId);
        const aiResult = await interpretMessage(accountId, text, new Date().toISOString(), snippets, history, timezone);

        if (aiResult.ok) {
          const recognizedIntents = aiResult.intents.filter((i) => i.type !== "unrecognized");
          if (recognizedIntents.length > 0) {
            const chatIntent = recognizedIntents.find((i): i is { type: "chat"; text: string } => i.type === "chat");
            const toolIntents = recognizedIntents.filter((i) => i.type !== "chat");

            const rawChatText = chatIntent?.text ?? "";
            const isToolDescription = /\b(save|saved|note from|your note|a note|task added|reminder set)\b/i.test(rawChatText) && toolIntents.length > 0;

            let replyText: string;
            if (chatIntent && !isToolDescription) {
              for (const intent of toolIntents) {
                await executeAiIntent(accountId, intent);
              }
              replyText = chatIntent.text;
            } else {
              const results = await Promise.all(toolIntents.map((i) => executeAiIntent(accountId, i)));
              replyText = results.join("\n");
            }

            await recordExchange(accountId, "assistant", replyText);
            void maybeSummarizeOldConversation(accountId, await countExchanges(accountId));
            return { kind: "text", text: replyText };
          }
        }
      } else {
        return { kind: "text", text: `AI is off for your account, so I can only follow specific commands. Try "help" to see what I can do, or send "ai on" to chat freely.` };
      }
    }

    // Rigid parsers fell through (parsing failed). Give contextual hints.
    if (lower.startsWith("remind me ")) {
      return { kind: "text", text: `I couldn't understand the time. Try "remind me call mom in 2h" or "remind me stretch at 9am". If you have AI on, just say it naturally.` };
    }
    if (lower.startsWith("alarm ")) {
      return { kind: "text", text: `I couldn't understand the time. Try "alarm wake me up in 30m" or "alarm stand up at 2pm".` };
    }
    if (lower.startsWith("task ") && /by\s+/i.test(lower)) {
      return { kind: "text", text: `I couldn't understand the time. Try "task finish report by tomorrow" or just "task buy groceries".` };
    }
    if (lower.startsWith("snooze ")) {
      return { kind: "text", text: `Try: snooze a1b2c3d4 1h — use "reminders" to see your reminder ids.` };
    }

    return { kind: "text", text: `Not sure what you mean. Try "help" to see what I can do, or just say something like "note hello world" or "remind me to call mom".` };
  } catch (err) {
    logError("handleCommand", err, { platform: cmd.platform });
    return { kind: "text", text: "Something went wrong on my end. Give it another try in a moment." };
  }
}

/**
 * Executes a single AI-proposed intent and returns one plain-text
 * outcome line. Extracted out of handleCommand's natural-language
 * fallback so a multi-item request (see interpretMessage's
 * "distinct items" handling) can call this once per item without
 * duplicating the validate-then-mutate logic per intent type.
 *
 * Every branch still re-validates through the exact same Zod schemas
 * used by manually typed commands before touching any service function
 * — this function does not weaken that guarantee, it only changes how
 * many times it's invoked per incoming message.
 */
async function executeAiIntent(accountId: string, intent: AiIntent): Promise<string> {
  switch (intent.type) {
    case "create_note": {
      const validation = safeValidate(createNoteSchema, {
        title: intent.title,
        body: intent.body,
        tags: [],
      });
      if (!validation.ok) return `Couldn't save that note: ${validation.error}`;

      const result = await createNote(accountId, validation.data);
      if (!result.ok) return `⚠ ${result.error}`;

      // This function is only ever reached from the natural-language
      // fallback, which already required isAiEnabledForAccount to be
      // true before calling interpretMessage — so embedding here
      // doesn't need a second opt-in check; the user already consented
      // to AI processing of their notes by reaching this path.
      if (isSemanticSearchConfigured) void embedNoteInBackground(accountId, result.data.id);

      return `Got it, I'll remember that.`;
    }
    case "create_task": {
      const validation = safeValidate(createTaskSchema, {
        title: intent.title,
        dueAt: intent.dueAt ? new Date(intent.dueAt) : undefined,
        priority: "normal",
      });
      if (!validation.ok) return `Couldn't save that task: ${validation.error}`;

      const result = await createTask(accountId, validation.data);
      if (!result.ok) return `⚠ ${result.error}`;

      return `Done! I'll keep track of that.`;
    }
    case "create_reminder": {
      const validation = safeValidate(createReminderSchema, {
        message: intent.message,
        remindAt: new Date(intent.remindAt),
        recurrence: intent.recurrence,
      });
      if (!validation.ok) return `Couldn't schedule that: ${validation.error}`;

      const result = await createReminder(accountId, validation.data);
      if (!result.ok) return `⚠ ${result.error}`;

      const recurrenceNote = validation.data.recurrence === "none" ? "" : ` I'll repeat this ${validation.data.recurrence}.`;
      return `You're all set${recurrenceNote}`;
    }
    case "create_alarm": {
      const remindAt = new Date(intent.remindAt);
      const validation = safeValidate(createReminderSchema, {
        message: intent.message,
        remindAt,
        recurrence: "none",
        isAlarm: true,
      });
      if (!validation.ok) return `Couldn't set that alarm: ${validation.error}`;

      const result = await createReminder(accountId, validation.data);
      if (!result.ok) return `⚠ ${result.error}`;

      return `🔔 I've got you covered. I'll keep reminding you until you acknowledge it.`;
    }
    case "answer_question":
      return intent.answer;
    case "chat":
      return intent.text;
    default:
      // Unreachable in practice: callers filter out "unrecognized"
      // intents before invoking this function (see handleCommand).
      // Kept as a safe fallback rather than an assertion, since a
      // narrower AiIntent union added later could otherwise silently
      // fall through with no return value.
      return `I didn't understand one part of that.`;
  }
}
