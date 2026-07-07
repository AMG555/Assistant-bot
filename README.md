<p align="center">
  <img src="https://img.shields.io/github/stars/amg555/Assistant-bot?style=for-the-badge&logo=github" alt="stars">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript" alt="typescript">
  <img src="https://img.shields.io/badge/Render-deployed-46E3B7?style=for-the-badge&logo=render" alt="render">
  <img src="https://img.shields.io/badge/Supabase-Free-3FCF8E?style=for-the-badge&logo=supabase" alt="supabase">
</p>

# Notion-Bot Assistant

**Your personal assistant, wherever you chat.** Save notes, track tasks, set reminders, and search everything — from Telegram, Discord, or WhatsApp. No app to install, no subscription fee. Runs on Render's free tier.

> 👋 **New here?** Read the **[User Guide](docs/user-guide.md)** for a gentle walkthrough of every command with examples.

```
You:        remind me to call mom tomorrow at 9am
Bot:        Got it! I'll remind you in 20h.

You:        note meeting notes | discussed Q3 budget, decided to cut hosting costs
Bot:        Saved your note!

You:        ask what did I decide about hosting?
Bot:        You decided to cut hosting costs during the Q3 budget meeting.

You:        🎤 [voice message: "add milk and eggs to shopping list"]
Bot:        Got it — you said: add milk and eggs to shopping list. Saved your note!
```

---

## Features

| | |
|---|---|
| 📝 **Notes** | Save and search notes. Full-text or semantic (AI) search. |
| ✅ **Tasks** | To-do list with due dates. Mark done, undo, list open. |
| ⏰ **Reminders** | One-time or recurring (daily/weekly/monthly). Timezone-aware. DST-safe. |
| 🧠 **AI Assistant** | Natural language: "remind me X and also save Y". Powered by Groq (Llama 3.3 70B). |
| 🎤 **Voice Notes** | Send a voice message — transcribed automatically via Whisper. |
| 📊 **Charts** | Visualize your weekly/monthly activity. |
| 📰 **Daily Digest** | Optional morning summary of tasks, reminders, and notes. |
| 🔗 **Platform Linking** | Connect Telegram + Discord to one account. |
| 🔄 **Notion Sync** | Two-way OAuth sync with your Notion workspace. |
| 📱 **Cross-Platform** | Telegram (live), Discord (live), WhatsApp (live). |

---

## Quick Links

| If you are... | Start here |
|---|---|
| 🧑 A **user** who wants to use the bot | [`docs/user-guide.md`](docs/user-guide.md) — full command reference |
| 🏗 A **developer** extending the bot | [`docs/architecture.md`](docs/architecture.md) — layers, patterns, adding platforms |
| 🛠 An **operator** deploying your own instance | [`docs/operator-runbook.md`](docs/operator-runbook.md) — step-by-step setup |
| 🔗 Connecting **external services** (n8n, IFTTT) | [`docs/webhook-inbox.md`](docs/webhook-inbox.md) — webhook integration |
| 📱 Building a **mobile/web app** for your bot | [`docs/mobile-integration.md`](docs/mobile-integration.md) — WebSocket chat, FCM push, REST API |
| 🔄 Setting up **Notion sync** | [`docs/notion-sync.md`](docs/notion-sync.md) — OAuth + two-way sync |
| 🐳 Running with **Docker** | [`docs/docker.md`](docs/docker.md) — container deployment |

---

## Quick Start (10 minutes)

```bash
git clone https://github.com/amg555/Assistant-bot.git
cd Assistant-bot
npm install
npm run setup          # interactive wizard — prompts for keys, creates .env
npm run build
npm start
```

> `npm run setup` walks you through each key, auto-generates secrets, and can optionally run the DB migration and register the Telegram webhook for you.

Then **talk to your bot on Telegram** — it understands plain English.

> Full setup guide → [`docs/operator-runbook.md`](docs/operator-runbook.md)

---

## How it works

```
                                        ┌──────────────────────────────────────────┐
                                        │              Express Server              │
  Telegram ─── webhook ───┐             │  ┌──────────────────────────────────┐   │
                          │             │  │       Webhook Verification        │   │
  Discord  ─── webhook ───┼── verify ──→  │  (secret_token / Ed25519 / HMAC)  │   │
                          │             │  └──────────┬───────────────────────┘   │
  WhatsApp ─── webhook ───┘             │             ↓                          │
                                        │  ┌──────────────────────────────────┐   │
  External  ─── webhook ────────────────→  │     Adapter Layer (platform)     │   │
  (n8n/IFTTT)         POST              │  │  parse → IncomingCommand → reply  │   │
                                        │  └──────────┬───────────────────────┘   │
                                        │             ↓                          │
                                        │  ┌──────────────────────────────────┐   │
                                        │  │     Command Handler (agnostic)   │   │
                                        │  │  ┌───────┐  ┌──────┐  ┌──────┐  │   │
                                        │  │  │Notes  │  │Tasks │  │Remind│  │   │
                                        │  │  └───────┘  └──────┘  └──────┘  │   │
                                        │  │  ┌───────┐  ┌──────┐  ┌──────┐  │   │
                                        │  │  │Alarms │  │Charts│  │Ask AI│  │   │
                                        │  │  └───────┘  └──────┘  └──────┘  │   │
                                        │  └──────────┬───────────────────────┘   │
                                        │             │                          │
                                        │  ┌──────────▼───────────────────────┐  │
                                        │  │         Service Layer            │  │
                                        │  │  ┌────────┐ ┌────────┐ ┌──────┐ │  │
                                        │  │  │Account  │ │Notes   │ │Tasks │ │  │
                                        │  │  │ Service │ │Service │ │Service│ │  │
                                        │  │  └────────┘ └────────┘ └──────┘ │  │
                                        │  │  ┌────────┐ ┌────────┐ ┌──────┐ │  │
                                        │  │  │Reminder│ │AI      │ │RAG   │ │  │
                                        │  │  │Service │ │Service │ │Service│ │  │
                                        │  │  └───┬────┘ └───┬────┘ └──┬───┘ │  │
                                        │  └──────┼──────────┼─────────┼──────┘  │
                                        └─────────┼──────────┼─────────┼─────────┘
                                                  │          │         │
            ┌──────────────────────────┐  ┌───────▼──┐ ┌──────▼──┐ ┌──▼────────┐
            │     External AI / Search  │  │ Supabase │ │  Groq   │ │   Jina    │
            │                          │  │ (PG +     │ │(Llama 3  │ │(Embeddings│
            │  ┌──────┐  ┌───────────┐ │  │  Storage) │ │ 70B /    │ │ 256-dim)  │
            │  │Notion│  │ Webhook   │ │  │           │ │ Whisper) │ │           │
            │  │OAuth │  │ Inbox     │ │  │ Tables:   │ │          │ │           │
            │  │+ Sync│  │(external  │ │  │ accounts  │ │          │ │           │
            │  └──────┘  │ POST)     │ │  │ notes     │ │          │ │           │
            │            └───────────┘ │  │ tasks     │ │          │ │           │
            │                          │  │ reminders │ │          │ │           │
            │                          │  │ conv_hist │ │          │ │           │
            │                          │  │ activity  │ │          │ │           │
            └──────────────────────────┘  └───────────┘ └──────────┘ └───────────┘
```

- **Zero client-side code.** The bot server holds the only Supabase key.
- **Every webhook is cryptographically verified** — Telegram (secret token), Discord (Ed25519), WhatsApp (HMAC).
- **AI is opt-in, twice over.** Server must have `GROQ_API_KEY` AND you must say `ai on`. Groq can never write directly to your data — every action is re-validated through Zod before touching the database.
- **Conversation memory survives cold starts.** Recent chat history stored in Supabase. Old conversations automatically summarized into searchable notes.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ / TypeScript 5 |
| Framework | Express 5 |
| Database | Supabase (PostgreSQL + pgvector) |
| AI | Groq (Llama 3.3 70B, Whisper) |
| Embeddings | Jina AI (Matryoshka, 256-dim) |
| Hosting | Render (free tier) |
| Scheduling | Supabase pg_cron + cron-job.org |
| Containers | Docker (optional) |

---

## Tests

```bash
npm test          # 99 tests covering timezone math, recurrence, encryption, validation
npm run typecheck # full TypeScript check
```

---

## Project Layout

```
src/
  config/env.ts        Zod-validated env (fail-fast at boot)
  lib/                 Logger, Supabase client, crypto, time parsing
  middleware/          Signature verification, rate limiting
  validation/          Zod schemas — single source of truth
  services/           DB access, AI, RAG, chart rendering
  router/             Platform-agnostic command handler
  adapters/           Telegram, Discord, WhatsApp webhooks
  routes/             Cron dispatch, OAuth, webhook
  server.ts           Express bootstrap
supabase/schema.sql   Tables, indexes, RLS, pg_cron jobs
```

---

## Architecture Decisions

Every significant design choice is documented — why reminders use Supabase cron instead of in-process timers, why RLS is enabled even on a server-only app, why OAuth over pasted tokens for Notion, and the exact trade-offs of Render's free tier. See [`docs/`](docs/) for the full reasoning.

---

## License

MIT
