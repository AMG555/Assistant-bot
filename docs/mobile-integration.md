# Mobile & Web App Integration

Build a mobile app or web frontend that talks to your personal assistant bot — send messages, trigger alarms, receive push notifications, and manage data anywhere.

---

## Overview

The bot exposes two integration surfaces:

| Surface | What it does | Best for |
|---|---|---|
| **Webhook Inbox** | Receive external data as notes | n8n, IFTTT, GitHub, email forwarding |
| **Push Notification Channel** | Deliver alarms/reminders to a mobile device | Custom mobile/web app |

A third option — **building a full chat UI on top of the bot** — is also possible by reusing the platform adapters.

---

## 1. Webhook Inbox (already built)

Every account has a webhook inbox at:

```
POST /webhooks/incoming/:accountId
```

Authenticate with `X-Webhook-Secret` header (get yours via the `webhook link` command). The body is saved as a note automatically.

**In your mobile app:**

```typescript
// From any HTTP client (React Native, Flutter, Swift, Kotlin)
await fetch("https://your-bot.onrender.com/webhooks/incoming/YOUR_ACCOUNT_ID", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Secret": "your-secret",
  },
  body: JSON.stringify({
    text: "Battery at 15% — charge soon",
    source: "my-phone-battery-monitor",
  }),
});
```

**Use cases in a mobile app:**
- Log sensor data (location, battery, step count) as searchable notes
- Quick-capture ideas from a widget
- Forward notifications from other apps to the assistant

Full API reference: [`docs/webhook-inbox.md`](webhook-inbox.md)

---

## 2. Push Notifications for Alarms & Reminders

The bot's proactive delivery system (`src/lib/deliverToAccount.ts`) currently supports Telegram and WhatsApp. To add mobile push notifications, you need:

### Step 1: Add an FCM service

```typescript
// src/services/pushService.ts
import { env } from "../config/env.js";

let fcmAccessToken: string | null = null;

async function getFcmToken(): Promise<string | null> {
  // Use Google's OAuth2 to exchange a service-account JSON key
  // for a short-lived access token (expires ~1 hour).
  // See: https://developers.google.com/identity/protocols/oauth2/service-account
  return fcmAccessToken;
}

export async function sendPushNotification(
  deviceToken: string,
  title: string,
  body: string
): Promise<boolean> {
  try {
    const token = await getFcmToken();
    if (!token) return false;

    const res = await fetch("https://fcm.googleapis.com/v1/projects/YOUR_PROJECT_ID/messages:send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          android: { priority: "high" },
          apns: { payload: { aps: { sound: "default" } } },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

### Step 2: Register device tokens

Add a `device_tokens` table to Supabase:

```sql
create table public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  token       text not null,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  created_at  timestamptz not null default now(),
  unique(account_id, token)
);

alter table public.device_tokens enable row level security;
```

Add a registration endpoint:

```typescript
// src/routes/deviceRegistrationRoute.ts
import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";

export const deviceRouter = Router();

deviceRouter.post("/api/devices/register", async (req, res) => {
  const { accountId, token, platform } = req.body;

  if (!accountId || !token || !["ios", "android", "web"].includes(platform)) {
    return res.status(400).json({ error: "Missing or invalid fields" });
  }

  try {
    await supabaseAdmin.from("device_tokens").upsert(
      { account_id: accountId, token, platform },
      { onConflict: "account_id,token" }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    logError("deviceRegistrationRoute", err);
    return res.status(500).json({ error: "internal_error" });
  }
});
```

Register the route in `server.ts`:

```typescript
import { deviceRouter } from "./routes/deviceRegistrationRoute.js";
app.use("/", deviceRouter);
```

### Step 3: Extend `deliverToAccount.ts`

```typescript
// Inside deliverToAccount, after the existing Telegram/WhatsApp sends:
const { data: devices } = await supabaseAdmin
  .from("device_tokens")
  .select("token")
  .eq("account_id", accountId);

if (devices) {
  await Promise.allSettled(
    devices.map((d) => sendPushNotification(d.token, "Assistant Bot", message))
  );
}
```

Now alarms and reminders will also arrive as push notifications on the user's device.

---

## 3. Full Chat Integration (advanced)

If you want to build a custom chat UI instead of using Telegram/Discord/WhatsApp:

### Option A: Webhook pattern

Your app sends a POST to a custom webhook:

```
POST /api/chat
Content-Type: application/json

{
  "accountId": "...",
  "text": "remind me to buy milk tomorrow at 9am"
}
```

Response:

```json
{
  "reply": "Got it! I'll remind you in ~20 hours."
}
```

Implementation sketch:

```typescript
// src/routes/chatApiRoute.ts
import { Router } from "express";
import { handleCommand } from "../router/commandHandler.js";

export const chatApiRouter = Router();

chatApiRouter.post("/api/chat", async (req, res) => {
  const { accountId, text } = req.body;
  if (!accountId || !text) {
    return res.status(400).json({ error: "accountId and text are required" });
  }

  const reply = await handleCommand({
    platform: "api",
    platformUserId: accountId,
    text,
    resolvedAccountId: accountId,
  });

  return res.json({ reply: reply.text });
});
```

### Option B: Full-duplex (WebSocket)

For a real-time chat experience, add a WebSocket endpoint that uses the same `handleCommand` function:

```typescript
// In server.ts
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const accountId = url.searchParams.get("accountId");

  ws.on("message", async (data) => {
    const text = data.toString();
    const reply = await handleCommand({
      platform: "websocket",
      platformUserId: accountId!,
      text,
      resolvedAccountId: accountId!,
    });
    ws.send(JSON.stringify({ reply: reply.text }));
  });
});
```

---

## Mobile App Architecture (recommended)

```
┌─────────────────────┐       ┌───────────────────────┐
│    Mobile App       │       │    Bot Server          │
│                     │       │                        │
│  ┌─────────────┐    │ POST  │  ┌─────────────────┐  │
│  │ Quick Capture│────┼───────→  │ Webhook Inbox   │  │
│  │ (widget)     │    │       │  │ (save as note)  │  │
│  └─────────────┘    │       │  └─────────────────┘  │
│                     │       │                        │
│  ┌─────────────┐    │ POST  │  ┌─────────────────┐  │
│  │ Chat UI     │────┼───────→  │ Chat API Route  │  │
│  │ (send msgs) │    │       │  │ (handleCommand) │  │
│  └─────────────┘    │       │  └────────┬────────┘  │
│                     │       │           │            │
│  ┌─────────────┐    │  FCM  │  ┌────────▼────────┐  │
│  │ Push Notif  │←───┼───────│  │ Push Service   │  │
│  │ (alarms)    │    │       │  │ (deliverToAcc)  │  │
│  └─────────────┘    │       │  └─────────────────┘  │
└─────────────────────┘       └───────────────────────┘
```

### Recommended stack for the mobile app

| Layer | Options |
|---|---|
| **Framework** | React Native + Expo (fastest path) or Flutter or native Swift/Kotlin |
| **Push** | Firebase Cloud Messaging (FCM) for both Android & iOS |
| **Background tasks** | WorkManager (Android), BGTaskScheduler (iOS) |
| **Widget** | Android App Widget or iOS WidgetKit |

### Minimum v1 feature set

1. **Quick capture widget** — POST to webhook inbox with one tap
2. **Alarm delivery** — register FCM token, receive push when alarm fires
3. **Acknowledge button** — tap on push notification calls `acknowledgeReminder` via a simple API endpoint
4. **Settings page** — show account ID, webhook secret, FCM registration status

---

## Security Considerations

- **Never embed your Supabase service_role key in the mobile app.** The bot server is the only thing that holds privileged keys. The mobile app talks to the bot server via HTTPS, never directly to Supabase.
- **Account IDs are UUIDs** — they are not guessable but should still be treated as secrets. Store in secure device storage (Keychain/Keystore).
- **FCM tokens are per-device.** If the app is uninstalled and reinstalled, the user gets a new token. Add a `POST /api/devices/unregister` endpoint for cleanup.
- **Rate limit your chat API endpoint** to prevent abuse — the existing `rateLimitMiddleware` can be applied.
