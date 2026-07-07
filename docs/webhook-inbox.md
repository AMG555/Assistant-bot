# Webhook Inbox — External Service Integration

Your bot has a **webhook inbox** endpoint that accepts HTTP POSTs from any
external service and saves the payload as a note in your account.

## Getting your webhook URL

In any chat with the bot, send:

```
webhook link
```

The bot replies with your unique URL and secret. Keep the secret private —
anyone with it can write notes to your account.

## Making a request

```bash
curl -X POST https://your-bot.onrender.com/webhooks/incoming/<accountId> \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <your-secret>" \
  -d '{"text":"buy milk and eggs","source":"n8n"}'
```

### Request body (JSON)

| Field | Required | Description |
|---|---|---|
| `text` | Yes | The content to save as a note body |
| `title` | No | Custom title (default: "Webhook from <source>" or "Incoming webhook") |
| `source` | No | Label shown in the default title (e.g., "n8n", "IFTTT", "email") |

### Response

```json
{ "ok": true, "noteId": "uuid-here" }
```

## Connecting with n8n

Once you have n8n self-hosted:

1. In n8n, create a new workflow with any trigger (Webhook, Cron, Email, etc.)
2. Add an **HTTP Request** node
3. Configure:
   - **Method**: POST
   - **URL**: your webhook URL from `webhook link`
   - **Headers**: `X-Webhook-Secret: <your-secret>`
   - **Content Type**: JSON
   - **Body**: `{ "text": "{{ ... }}", "source": "n8n" }`

### Example: Save new GitHub stars as notes

1. Trigger: **GitHub Webhook** (star event)
2. HTTP Request node → your bot's webhook URL
3. Body:
   ```json
   {
     "text": "{{ $json.repository.full_name }} got a star from {{ $json.sender.login }}",
     "title": "New GitHub star",
     "source": "github"
   }
   ```

## Connecting with IFTTT

1. Create an IFTTT applet with any trigger
2. Action: **Webhooks → Make a web request**
3. Configure:
   - **URL**: your webhook URL
   - **Method**: POST
   - **Content Type**: application/json
   - **Body**: `{ "text": "<<<text>>>", "source": "ifttt" }`
   - **Headers**: `X-Webhook-Secret: <your-secret>`

## Connecting with email forwarders (Cloudflare Email Routing, Forward Email, etc.)

1. Set up email forwarding to a webhook URL via a service like
   **Cloudflare Email Routing** (free) or **SendGrid Inbound Parse**
2. Configure the target URL to your webhook endpoint
3. The email body is sent as `text`
4. Example with Cloudflare Email Routing:
   - Create an email routing rule → Send to webhook
   - Set up a Worker that transforms the email into `{ "text": "<email body>", "title": "<subject>", "source": "email" }`
   - POST to your webhook URL

## Use cases

- **Email-to-note**: Forward a bill or receipt → saved as a note
- **GitHub notifications**: New issues, PRs, stars → saved as notes
- **Price alerts**: A service like Distill or Visualping detects a change → saves as note
- **Weather alerts**: IFTTT weather trigger → saves reminder
- **Social media**: New mentions, DMs → forwarded to your bot
- **n8n automation**: Complex multi-step workflows with AI, databases, APIs
