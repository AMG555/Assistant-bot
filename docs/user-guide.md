# User Guide — Notion Bot Assistant

A friendly bot that lives in your Telegram (and soon Discord/WhatsApp).
It saves notes, tracks tasks, sets reminders, and answers questions about
your stuff. Everything is stored in your own private account — no signup,
no app install, just message the bot.

---

## Getting Started

Find your bot on Telegram and send:

```
/start
```

The bot replies with a welcome message. Try these first:

```
note My first note | hello world
task Finish report by tomorrow
remind me call mom in 2h
```

---

## Commands

### 📝 Notes

Save anything you want to remember — ideas, grocery lists, meeting notes,
links, whatever.

```
note <title> | <body>
```

Examples:

```
note Shopping list | milk, eggs, bread, butter
note Meeting notes | discussed Q3 budget, decided to cut hosting costs
note Book recommendation | Atomic Habits by James Clear — really good
```

**View your notes:**

```
notes
```

Shows your 10 most recent notes by title.

### ✅ Tasks

Track things you need to do.

```
task <title> [by <when>]
```

Examples:

```
task Buy birthday gift
task Finish presentation by Friday
task Submit report by tomorrow at 5pm
```

**View open tasks:**

```
tasks
```

Shows all open tasks with their IDs and due dates.

**Mark a task done:**

```
done <task-id>
```

Use the short ID shown in `tasks` output:

```
tasks
→ • a1b2c3d4 Buy birthday gift (due in 3d)
done a1b2c3d4
→ Done! "Buy birthday gift" marked complete.
```

**Undo a completed task:**

```
undo
```

Reverts your last action (note, task, or reminder).

### ⏰ Reminders

Never forget anything again.

**Simple (relative time):**

```
remind me <message> in <time>
```

Time accepts digits + unit: `2h`, `30m`, `1d`, `10s` — and full English words: `5 minutes`, `2 hours`, `1 day`, `30 seconds`.

Examples:

```
remind me call mom in 2h
remind me take out trash in 30m
remind me water plants in 1d
remind me call mom in 5 minutes
```

**Clock time:**

```
remind me stretch at 9am
remind me stand up at 2:30pm
```

**Recurring (every day / week / month):**

```
remind me meditate at 7am every day
remind me take out trash at 8pm every week
remind me pay rent on the 1st every month
```

**View pending reminders:**

```
reminders
```

Shows all upcoming reminders with their IDs.

**Snooze a reminder:**

```
snooze <id> <duration>
```

Example:

```
snooze a1b2c3d4 1h
```

Pushes it back by the time you choose.

### 🧠 AI Features

Turn on natural-language mode and the bot understands plain English.

```
ai on
```

Now you can just talk naturally:

```
"remind me to buy milk and also save a note about the budget meeting"
```

The bot figures out what you mean — it can handle multiple things in one
message.

**Ask about your notes:**

```
ask <question>
```

Examples:

```
ask what did I write about the budget?
ask what meetings did I have this week?
ask what's on my shopping list?
```

The bot searches your notes and answers from what it finds.

**Turn AI off anytime:**

```
ai off
```

### 🎤 Voice Messages

Send a voice message — the bot transcribes it automatically (works just
like typing). Only available when AI is on.

### 📊 Activity Charts

See what you've been up to:

```
chart
chart 30d
chart 7d tasks
chart 30d all
```

The bot sends you a chart image showing your activity over the week or
month.

### 📰 Daily Digest

Get a morning summary of what's coming up:

```
digest on
digest on at 9am
digest off
```

The bot sends you a daily message with:
- Tasks due today
- Reminders scheduled
- Notes you added recently

### ⚙️ Settings

**Set your timezone** (important for clock-time reminders):

```
timezone Asia/Kolkata
timezone America/New_York
timezone Europe/London
```

Use [IANA timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

**Link another platform** (use Telegram + Discord together):

```
link
```

The bot gives you a one-time code. On your other platform, send:

```
connect <code>
```

Now both platforms share the same notes, tasks, and reminders.

### 🔗 Webhook Inbox

Connect external services (n8n, IFTTT, email forwarders) to push data
into your bot as notes.

```
webhook link
```

Returns a URL and secret. Any service can POST JSON to that URL and it's
saved as a note in your account. See [`docs/webhook-inbox.md`](webhook-inbox.md)
for examples.

### 🔗 Outgoing Webhook

Forward proactive messages (reminders, digests) from the bot to your own
service.

```
webhook out <url>
webhook out off
```

The bot POSTs `{ "event": "message_sent", "text": "..." }` to your URL
every time it sends you a reminder or digest. See
[`docs/webhook-inbox.md`](webhook-inbox.md) for details.

### 🔄 Notion Sync

Sync notes with your Notion workspace (requires setup on the server):

```
notion connect
notion database <database-id>
notion status
notion disconnect
```

---

## Privacy

- **AI is opt-in.** Nothing is sent to any AI provider until you run
  `ai on`. You can turn it off anytime with `ai off`.
- **Your data is yours.** All notes, tasks, and reminders are stored in
  your own isolated account. The server operator cannot read your data
  (it's in Supabase, not in any shared database).
- **Voice messages** downloaded from Telegram are transcribed and then
  deleted. The audio file is never stored permanently.

---

## Tips

- **Combine things** — the AI understands "remind me to buy milk at 5pm
  and save a note about the budget" in one message
- **Use ask** after ai on — it searches your notes using AI, not just
  keywords
- **Undo** works for your last action (note/task/reminder), up to a few
  minutes
- **Timezones matter** — set yours if you use clock-time reminders
- **Recurring reminders** — add "every day/week/month" to any reminder
