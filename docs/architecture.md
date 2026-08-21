# Architecture Guide

How the bot is built, how the layers connect, and how to extend it.

---

## High-Level Overview

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
            │     External Integrations│  │ Supabase │ │  Groq   │ │   Jina    │
            │                          │  │ (PG +     │ │(GPT-OSS │ │(Embeddings│
            │  ┌──────┐  ┌───────────┐ │  │  Storage) │ │ 120B/20B│ │ 256-dim)  │
            │  │Notion│  │ Webhook   │ │  │           │ │ Whisper)│ │           │
            │  │OAuth │  │ Inbox     │ │  │ Tables:   │ │         │ │           │
            │  │+ Sync│  │(external  │ │  │ accounts  │ │         │ │           │
            │  └──────┘  │ POST)     │ │  │ notes     │ │         │ │           │
            │            └───────────┘ │  │ tasks     │ │         │ │           │
            │                          │  │ reminders │ │         │ │           │
            │                          │  │ conv_hist │ │         │ │           │
            │                          │  │ activity  │ │         │ │           │
            └──────────────────────────┘  └───────────┘ └─────────┘ └───────────┘

**Key principle:** Every layer only talks to the one below it. Adapters never touch the database. Services never format a message. The command handler never knows if the user is on Telegram or Discord.

---

## Layer Breakdown

### 1. Adapter Layer (`src/adapters/<platform>/`)

Each platform has a thin adapter with two responsibilities:

| File | Responsibility |
|---|---|
| `webhookRoute.ts` | Receive incoming messages, verify signatures, call `handleCommand()` |
| `client.ts` | Send messages back (text, photo, etc.) |

The adapter's job is to:
1. Parse the platform's webhook payload into an `IncomingCommand`
2. Call `handleCommand()`
3. Convert the returned `BotReply` into whatever the platform needs

### 2. Command Handler (`src/router/commandHandler.ts`)

This is **the core of the bot**. It's completely platform-agnostic.

```typescript
export type BotReply =
  | { kind: "text"; text: string }
  | { kind: "image"; caption: string; buffer: Buffer };

export interface IncomingCommand {
  platform: "telegram" | "discord" | "whatsapp";
  platformUserId: string;
  displayName?: string;
  text: string;
  resolvedAccountId?: string;
}
```

**Contract:** Any adapter anywhere in the world can construct an `IncomingCommand`, call `handleCommand()`, and send the resulting `BotReply` back however it wants. No business logic lives outside this function.

The handler:
- Resolves or creates the account
- Routes the message (exact commands first, then AI fallback)
- Returns a reply

### 3. Service Layer (`src/services/`)

Each service file owns one domain and only talks to Supabase or external APIs:

| Service | Domain |
|---|---|
| `accountService.ts` | Accounts, identities, settings, webhook secrets |
| `notesService.ts` | CRUD notes |
| `tasksService.ts` | CRUD tasks |
| `remindersService.ts` | CRUD reminders, dispatch, acknowledgment |
| `aiService.ts` | Groq chat (GPT-OSS 120B/20B), vision (Qwen 3.6 27B), transcription (Whisper), digest summarization, multi-model fallback |
| `ragService.ts` | Note retrieval (full-text or semantic search) |
| `chartService.ts` | Activity chart rendering |
| `notionSyncService.ts` | Two-way Notion sync |

**Pattern:** Every service function returns a `ServiceResult<T>`:

```typescript
type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: "not_found" | "conflict" | "expired" | "internal" };
```

This ensures callers **always** handle failure explicitly — no thrown exceptions from services.

### 4. Middleware (`src/middleware/`)

| Middleware | What it protects |
|---|---|
| `verifyTelegram.ts` | Telegram webhook (secret token) |
| `verifyDiscord.ts` | Discord interactions (Ed25519 signature) |
| `verifyWhatsApp.ts` | WhatsApp webhook (HMAC-SHA256) |
| `verifyCronSecret.ts` | Internal cron dispatch (shared secret) |
| `rateLimit.ts` | Per-account rate limiting (in-memory) |

### 5. Lib (`src/lib/`)

Shared utilities:

| Module | Purpose |
|---|---|
| `supabase.ts` | Single Supabase admin client instance |
| `logger.ts` | Structured JSON logging (Pino) |
| `parseWhen.ts` | Natural language time parsing + recurrence |
| `conversationMemory.ts` | Persistent conversation history (Supabase-backed) |
| `undoStore.ts` | In-memory undo stack (per-account) |
| `deliverToAccount.ts` | Proactive multi-platform message delivery |
| `migrate.ts` | Startup database migrations |

### 6. Validation (`src/validation/schemas.ts`)

All user input is validated through Zod schemas — the **single source of truth** for what data looks like. Both manually typed commands AND AI-proposed tool calls pass through the exact same schemas before touching the database.

---

## Adding a New Platform

To add a new platform (e.g., Matrix, Slack, SMS, web app):

### 1. Create the adapter directory

```
src/adapters/matrix/
  webhookRoute.ts    ← receive messages
  client.ts          ← send messages
```

### 2. Implement the webhook route

```typescript
// src/adapters/matrix/webhookRoute.ts
import { Router } from "express";
import { handleCommand } from "../../router/commandHandler.js";

export const matrixRouter = Router();

matrixRouter.post("/webhook", async (req, res) => {
  // 1. Verify the webhook signature
  // 2. Parse the payload into an IncomingCommand
  const reply = await handleCommand({
    platform: "matrix",
    platformUserId: req.body.sender,
    displayName: req.body.display_name,
    text: req.body.content.body,
  });

  // 3. Send the reply back however the platform expects
  if (reply.kind === "text") {
    await sendMatrixMessage(req.body.room_id, reply.text);
  }

  res.status(200).json({ ok: true });
});
```

### 3. Register the route in `server.ts`

```typescript
import { matrixRouter } from "./adapters/matrix/webhookRoute.js";
// ...
app.use("/matrix", matrixRouter);
```

### 4. Add proactive delivery support (optional)

For reminders and daily digests, update `deliverToAccount()` in `src/lib/deliverToAccount.ts` to include the new platform.

That's it. `handleCommand()` handles account resolution, command routing, AI, validation, everything.

---

## Database Entity Relationships

```
accounts (1) ──── (N) platform_identities    ← one human, many chat accounts
accounts (1) ──── (N) notes                   ← notes (title + body + tags)
accounts (1) ──── (N) tasks                   ← to-dos with due dates
accounts (1) ──── (N) reminders               ← timed notifications
accounts (1) ──── (N) conversation_history    ← chat memory for AI context
accounts (1) ──── (N) activity_log            ← audit trail for charts
accounts (1) ──── (N) link_codes              ← one-time platform linking
accounts (1) ──── (N) oauth_states            ← Notion OAuth CSRF tokens
accounts (1) ──── (N) notion_connections      ← Notion workspace links
```

Every table has `account_id` and is scoped by it. No cross-account data leakage is possible even with a bug in application code — the SQL itself enforces `WHERE account_id = ?`.

---

## Key Design Decisions

| Decision | Why |
|---|---|
| **Supabase over SQLite/JSON file** | Survives cold restarts, multi-instance ready, free tier is generous |
| **In-memory undo + rate limiting** | Correct for single free instance; documented as a v1 limitation |
| **pg_cron for reminders, not in-process timers** | Render hibernates after 15min idle — in-process timers would silently die |
| **Two-layer AI opt-in** | Server needs `GROQ_API_KEY` AND user must run `ai on`. Prevents accidental data leaks |
| **Zod re-validation for AI tool calls** | Even if Groq hallucinates, every proposed action passes through the same schemas as manual commands |
| **RLS on every table** | Defense-in-depth for a future web dashboard with real Supabase Auth |
| **`ServiceResult<T>` everywhere** | Forces explicit error handling — no silent crashes or thrown exceptions from services |
