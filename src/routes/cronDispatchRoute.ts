import { Router } from "express";
import { verifyCronSecret } from "../middleware/verifyCronSecret.js";
import { fetchDueReminders, markReminderSent, markReminderFailedAttempt, markAlarmDelivered } from "../services/remindersService.js";
import { deliverToAccount } from "../lib/deliverToAccount.js";
import { logError, logger } from "../lib/logger.js";

export const cronRouter = Router();

let dispatchLock = false;

cronRouter.post("/internal/cron/dispatch", verifyCronSecret, async (_req, res) => {
  if (dispatchLock) {
    logger.warn({ context: "cronDispatchRoute" }, "dispatch_already_in_progress");
    return res.status(429).json({ error: "dispatch_already_in_progress" });
  }

  dispatchLock = true;
  try {
    const dueResult = await fetchDueReminders();
    if (!dueResult.ok) {
      return res.status(500).json({ error: dueResult.error });
    }

    let sent = 0;
    let failed = 0;

    for (const reminder of dueResult.data) {
      const shortId = reminder.id.slice(0, 8);
      const scheduledAt = new Date(reminder.remindAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const recurrenceNote = reminder.recurrenceRule !== "none" ? ` | Repeats ${reminder.recurrenceRule}` : "";
      const msg = reminder.isAlarm
        ? `🔔 ALARM: ${reminder.message}\n   Repeats every 5min until you say "acknowledge ${shortId}"`
        : `⏰ ${reminder.message}\n   ${scheduledAt}${recurrenceNote} | acknowledge ${shortId} to dismiss`;
      const delivered = await deliverToAccount(reminder.accountId, msg);
      if (delivered) {
        if (reminder.isAlarm) {
          await markAlarmDelivered(reminder.id);
        } else {
          await markReminderSent(reminder.id, reminder.accountId, reminder.message, reminder.recurrenceRule, reminder.remindAt);
        }
        sent += 1;
      } else {
        await markReminderFailedAttempt(reminder.id, reminder.deliveryAttempts, "No reachable platform identity or send failed");
        failed += 1;
      }
    }

    logger.info({ context: "cronDispatchRoute", sent, failed, total: dueResult.data.length }, "reminder_dispatch_cycle_complete");
    return res.status(200).json({ sent, failed, total: dueResult.data.length });
  } catch (err) {
    logError("cronDispatchRoute.dispatch", err);
    return res.status(500).json({ error: "internal_error" });
  } finally {
    dispatchLock = false;
  }
});

