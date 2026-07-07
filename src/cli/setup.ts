import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, exit } from "node:process";
import { randomBytes } from "node:crypto";
import { writeFile, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function bold(s: string) {
  return `\x1b[1m${s}\x1b[22m`;
}
function dim(s: string) {
  return `\x1b[2m${s}\x1b[22m`;
}
function green(s: string) {
  return `\x1b[32m${s}\x1b[39m`;
}
function yellow(s: string) {
  return `\x1b[33m${s}\x1b[39m`;
}
function red(s: string) {
  return `\x1b[31m${s}\x1b[39m`;
}

function genSecret(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function prompt(rl: any, question: string, defaultValue?: string): Promise<string> {
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${question}${hint}: `);
  return answer.trim() || defaultValue || "";
}

async function confirm(rl: any, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`${question} (${hint}): `);
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultYes;
  return trimmed === "y" || trimmed === "yes";
}

function validateUrl(value: string, label: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return `${label} must start with http:// or https://`;
    return null;
  } catch {
    return `${label} is not a valid URL`;
  }
}

function validateNotEmpty(value: string, label: string): string | null {
  if (!value) return `${label} cannot be empty`;
  return null;
}

async function main() {
  const rl = createInterface({ input, output });

  console.log(`
${bold("🤖 Assistant Bot — Setup Wizard")}
${dim("This will walk you through creating your .env file and deploying the bot.")}
`);

  const envPath = join(ROOT, ".env");

  let envExists = false;
  try {
    await access(envPath);
    envExists = true;
  } catch {}

  if (envExists) {
    const overwrite = await confirm(rl, `${yellow(".env already exists")}. Overwrite?`, false);
    if (!overwrite) {
      console.log(dim("Keeping existing .env. Exiting."));
      rl.close();
      return;
    }
  }

  console.log(bold("\n── Required: Platform & Database ──\n"));

  let supabaseUrl = "";
  while (!supabaseUrl) {
    supabaseUrl = await prompt(rl, "Supabase project URL", "https://YOUR-PROJECT.supabase.co");
    const err = validateUrl(supabaseUrl, "Supabase URL");
    if (err) {
      console.log(red(`  ✗ ${err}`));
      supabaseUrl = "";
    }
  }

  let supabaseKey = "";
  while (!supabaseKey) {
    supabaseKey = await prompt(rl, "Supabase service_role key");
    const err = validateNotEmpty(supabaseKey, "Supabase service_role key");
    if (err) {
      console.log(red(`  ✗ ${err}`));
    }
  }

  const storageBucket = await prompt(rl, "Storage bucket name", "user-attachments");

  let botToken = "";
  while (!botToken) {
    botToken = await prompt(rl, "Telegram bot token (from @BotFather)");
    const err = validateNotEmpty(botToken, "Bot token");
    if (err) {
      console.log(red(`  ✗ ${err}`));
    }
  }

  console.log(dim("  → Verifying token with Telegram API..."));
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meBody: any = await meRes.json();
    if (!meBody.ok) {
      console.log(red(`  ✗ Telegram rejected token: ${meBody.description || "unknown error"}`));
      rl.close();
      return;
    }
    console.log(green(`  ✓ Bot @${meBody.result.username} authenticated`));
  } catch (err: any) {
    console.log(red(`  ✗ Could not reach Telegram API: ${err.message}`));
    console.log(dim("  Continuing — you can verify later."));
  }

  let publicBaseUrl = "";
  while (!publicBaseUrl) {
    publicBaseUrl = await prompt(rl, "Public base URL (Render deployment URL)", "https://your-service.onrender.com");
    const err = validateUrl(publicBaseUrl, "Public base URL");
    if (err) {
      console.log(red(`  ✗ ${err}`));
      publicBaseUrl = "";
    }
  }

  console.log(bold("\n── Optional: AI Features ──\n"));
  console.log(dim("  Leave blank to skip. Can be added later to .env.\n"));

  const groqKey = await prompt(rl, "Groq API key (for AI features)");
  const groqModel = groqKey ? await prompt(rl, "Groq model", "llama-3.3-70b-versatile") : "";

  const jinaKey = await prompt(rl, "Jina API key (for semantic search)");

  console.log(bold("\n── Optional: Other Integrations ──\n"));
  console.log(dim("  Leave blank to skip. See docs/ for details.\n"));

  const discordAppId = await prompt(rl, "Discord app ID");
  const discordPublicKey = await prompt(rl, "Discord public key");
  const discordBotToken = await prompt(rl, "Discord bot token");

  const notionClientId = await prompt(rl, "Notion OAuth client ID");
  const notionClientSecret = await prompt(rl, "Notion OAuth client secret");
  const notionWebhookSecret = await prompt(rl, "Notion webhook secret");

  console.log(bold("\n── Generating secrets ──\n"));

  const internalCronSecret = genSecret(30);
  const telegramWebhookSecret = genSecret(20);
  const notionEncryptionKey = notionClientId ? genSecret(32) : "";

  console.log(`  ${dim("Internal cron secret")}     ${dim("(auto-generated)")}`);
  console.log(`  ${dim("Telegram webhook secret")}   ${dim("(auto-generated)")}`);
  if (notionEncryptionKey) console.log(`  ${dim("Notion encryption key")}     ${dim("(auto-generated)")}`);

  const envLines = [
    `NODE_ENV=production`,
    `PORT=10000`,
    `ALLOWED_ORIGINS=*`,
    ``,
    `# --- Supabase ---`,
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${supabaseKey}`,
    `SUPABASE_STORAGE_BUCKET=${storageBucket}`,
    ``,
    `# --- Internal ---`,
    `INTERNAL_CRON_SECRET=${internalCronSecret}`,
    ``,
    `# --- Telegram ---`,
    `TELEGRAM_BOT_TOKEN=${botToken}`,
    `TELEGRAM_WEBHOOK_SECRET=${telegramWebhookSecret}`,
    `PUBLIC_BASE_URL=${publicBaseUrl.replace(/\/$/, "")}`,
    ``,
    `# --- Discord ---`,
    `DISCORD_APP_ID=${discordAppId}`,
    `DISCORD_PUBLIC_KEY=${discordPublicKey}`,
    `DISCORD_BOT_TOKEN=${discordBotToken}`,
    ``,
    `# --- WhatsApp ---`,
    `WHATSAPP_APP_SECRET=`,
    `WHATSAPP_ACCESS_TOKEN=`,
    `WHATSAPP_PHONE_NUMBER_ID=`,
    `WHATSAPP_VERIFY_TOKEN=`,
    ``,
    `# --- Link codes ---`,
    `LINK_CODE_TTL_MINUTES=10`,
    ``,
    `# --- Groq ---`,
    `GROQ_API_KEY=${groqKey}`,
    `GROQ_MODEL=${groqModel || "llama-3.3-70b-versatile"}`,
    `GROQ_MAX_CALLS_PER_HOUR=30`,
    ``,
    `# --- Jina ---`,
    `JINA_API_KEY=${jinaKey}`,
    `JINA_EMBEDDING_MODEL=jina-embeddings-v3`,
    `JINA_EMBEDDING_DIMENSIONS=768`,
    ``,
    `# --- Notion ---`,
    `NOTION_OAUTH_CLIENT_ID=${notionClientId}`,
    `NOTION_OAUTH_CLIENT_SECRET=${notionClientSecret}`,
    `NOTION_WEBHOOK_SECRET=${notionWebhookSecret}`,
    `NOTION_TOKEN_ENCRYPTION_KEY=${notionEncryptionKey}`,
    `NOTION_MAX_REQUESTS_PER_SECOND=2`,
  ];

  await writeFile(envPath, envLines.join("\n") + "\n");
  console.log(green(`\n  ✓ .env written to ${envPath}`));

  if (groqKey) {
    console.log(dim("\n  ℹ AI is enabled at the server level. Users still need to run"));
    console.log(dim('    "ai on" per account before their data is sent to Groq.'));
  }

  console.log(bold("\n── Post-Setup Steps ──\n"));

  const doMigration = await confirm(rl, "Run database migration now? (requires Supabase DB connection string)", false);
  if (doMigration) {
    let dbUrl = "";
    while (!dbUrl) {
      dbUrl = await prompt(rl, "Supabase DB connection string (postgresql://...)");
      if (!dbUrl) {
        console.log(dim("  Skipping migration."));
        break;
      }
    }
    if (dbUrl) {
      try {
        const { default: pg } = await import("pg");
        const client = new pg.Client({ connectionString: dbUrl });
        await client.connect();
        const sql = `create table if not exists public.conversation_history (
          id uuid primary key default gen_random_uuid(),
          account_id uuid not null references public.accounts(id) on delete cascade,
          role text not null check (role in ('user', 'assistant')),
          text text not null,
          created_at timestamptz not null default now()
        );
        create index if not exists idx_conversation_history_account
          on public.conversation_history (account_id, created_at desc);
        alter table public.conversation_history enable row level security;
        do $$ begin
          if not exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'accounts' and column_name = 'webhook_secret')
          then alter table public.accounts add column webhook_secret text; end if;
        end $$;
        do $$ begin
          if not exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'reminders' and column_name = 'is_alarm')
          then alter table public.reminders add column is_alarm boolean not null default false;
          alter table public.reminders add column last_alarm_sent_at timestamptz; end if;
        end $$;`;
        await client.query(sql);
        await client.end();
        console.log(green("  ✓ Migration complete: conversation_history, webhook_secret, alarm columns"));
      } catch (err: any) {
        console.log(red(`  ✗ Migration failed: ${err.message}`));
        console.log(dim("  You can run it later via Supabase SQL editor with supabase/schema.sql"));
      }
    }
  }

  const doWebhook = await confirm(rl, "Register Telegram webhook now?", false);
  if (doWebhook) {
    const url = `${publicBaseUrl.replace(/\/$/, "")}/telegram/webhook`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, secret_token: telegramWebhookSecret }),
      });
      const body: any = await res.json();
      if (body.ok) {
        console.log(green(`  ✓ Webhook registered at ${url}`));
      } else {
        console.log(red(`  ✗ Telegram rejected webhook: ${body.description || "unknown"}`));
      }
    } catch (err: any) {
      console.log(red(`  ✗ Could not reach Telegram API: ${err.message}`));
    }
  }

  const doDiscordCommands = discordAppId && (await confirm(rl, "Register Discord slash commands now?", false));
  if (doDiscordCommands) {
    try {
      const cmds = [
        { name: "start", description: "Welcome message and quick overview" },
        { name: "note", description: "Save a quick note (reply with ID)", options: [{ type: 3, name: "text", description: "Note content", required: true }] },
        { name: "notes", description: "List recent notes" },
        { name: "tasks", description: "List pending and overdue tasks" },
        { name: "ask", description: "Ask the AI a question" },
        { name: "help", description: "Show command reference" },
        { name: "ai", description: "Toggle AI features on/off for your account", options: [{ type: 3, name: "state", description: "on or off", required: true }] },
      ];
      const res = await fetch(`https://discord.com/api/v10/applications/${discordAppId}/commands`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${discordBotToken}`,
        },
        body: JSON.stringify(cmds),
      });
      if (res.ok) {
        console.log(green("  ✓ Discord commands registered"));
      } else {
        console.log(red(`  ✗ Discord rejected: ${res.status} ${res.statusText}`));
      }
    } catch (err: any) {
      console.log(red(`  ✗ Could not reach Discord API: ${err.message}`));
    }
  }

  console.log(bold("\n── Summary ──\n"));
  console.log(green("  ✓ .env configured"));
  if (doMigration) console.log(green("  ✓ Database migration run"));
  if (doWebhook) console.log(green("  ✓ Telegram webhook registered"));
  if (doDiscordCommands) console.log(green("  ✓ Discord commands registered"));
  console.log(`
${bold("Next steps:")}
  1. ${dim("Review .env for any optional keys you want to add later")}
  2. ${dim("Run")} npm run dev ${dim("to start the bot locally")}
  3. ${dim("Deploy to Render using the operator runbook (docs/operator-runbook.md)")}
  4. ${dim("Set")} INTERNAL_CRON_SECRET ${dim("and other secrets in Render dashboard")}
`);

  rl.close();
}

main().catch((err) => {
  console.error(red(`\n  Fatal error: ${err.message}`));
  process.exit(1);
});
