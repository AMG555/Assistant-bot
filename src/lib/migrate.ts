import { logger } from "./logger.js";
import { env } from "../config/env.js";

const SQL = `
create table if not exists public.conversation_history (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  text          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_conversation_history_account
  on public.conversation_history (account_id, created_at desc);

alter table public.conversation_history enable row level security;

-- Add webhook_secret column if it doesn't exist (accounts table already exists).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'webhook_secret'
  ) then
    alter table public.accounts add column webhook_secret text;
  end if;
end $$;

-- Add alarm columns to reminders table.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reminders' and column_name = 'is_alarm'
  ) then
    alter table public.reminders add column is_alarm boolean not null default false;
    alter table public.reminders add column last_alarm_sent_at timestamptz;
  end if;
end $$;

-- Add outgoing_webhook_url column to accounts.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'outgoing_webhook_url'
  ) then
    alter table public.accounts add column outgoing_webhook_url text;
  end if;
end $$;
`;

export async function runMigrations(): Promise<void> {
  if (!env.SUPABASE_DB_URL) {
    logger.warn("SUPABASE_DB_URL not set — skipping startup migration. Run manually in Supabase SQL editor: alter table public.reminders add column if not exists is_alarm boolean not null default false; alter table public.reminders add column if not exists last_alarm_sent_at timestamptz;");
    return;
  }

  let client: any;
  try {
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
    await client.connect();
    await client.query(SQL);
    logger.info("Startup migration complete: conversation_history table ready");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Startup migration failed — conversation_history may not exist");
  } finally {
    if (client) try { await client.end(); } catch {}
  }
}
