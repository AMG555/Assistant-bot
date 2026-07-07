-- =====================================================================
-- Notion-Bot Assistant — Supabase schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
--
-- SECURITY MODEL
-- ---------------------------------------------------------------------
-- The bot server talks to Supabase using the SERVICE ROLE key, which
-- bypasses RLS by design. RLS is still enabled on every table below as
-- defense-in-depth: if this project ever adds a browser dashboard using
-- real Supabase Auth (anon key + user JWT), these policies guarantee a
-- logged-in user can only ever see their own rows, even if a server
-- route has a bug. Isolation is enforced at TWO layers, never one.
-- =====================================================================

create extension if not exists pgcrypto;   -- for gen_random_uuid()
create extension if not exists pg_cron;    -- scheduled reminder dispatch
create extension if not exists pg_net;     -- cron -> HTTP call into our API
-- Optional: only required if you enable real semantic search (Jina
-- embeddings) per docs/ai-integration.md. Safe to run even if you never
-- configure JINA_API_KEY — the embedding column just stays null and
-- semantic search silently isn't used, same "extra column that costs
-- nothing if unused" pattern as notion_page_id below.
create extension if not exists vector;

-- ---------------------------------------------------------------------
-- accounts: one row per human, independent of which chat platform
-- they talk to us from.
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  display_name       text,
  timezone           text not null default 'UTC',
  -- AI features (Groq-backed natural-language parsing, RAG-based note
  -- search) are OPT-IN and OFF by default. Nothing about this account's
  -- notes/tasks/reminders is ever sent to a third-party model provider
  -- unless the user explicitly runs "ai on". See src/services/aiService.ts.
  ai_enabled         boolean not null default false,
  -- Daily digest: also OPT-IN and OFF by default, since it's a form of
  -- unsolicited proactive messaging — some users want a purely reactive
  -- bot. digest_hour is the account's own LOCAL hour (0-23, resolved via
  -- `timezone` above), not a UTC hour. last_digest_sent_date is a
  -- "YYYY-MM-DD" key (in the account's own timezone) preventing the
  -- cron dispatcher, which runs every few minutes, from sending the same
  -- day's digest twice.
  digest_enabled       boolean not null default false,
  digest_hour          int not null default 8 check (digest_hour between 0 and 23),
  last_digest_sent_date text,
  -- Webhook inbox: a per-account secret for accepting external HTTP
  -- requests (IFTTT, n8n, email forwarders, etc.) as notes. Generated
  -- on first request via "webhook link" command. Null = not set up.
  webhook_secret       text,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- platform_identities: links a Telegram / Discord / WhatsApp identity
-- to exactly one account. Composite unique constraint prevents the same
-- external identity from ever being linked to two accounts.
-- ---------------------------------------------------------------------
create table if not exists public.platform_identities (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  platform           text not null check (platform in ('telegram', 'discord', 'whatsapp')),
  platform_user_id   text not null,
  display_name       text,
  linked_at          timestamptz not null default now(),
  unique (platform, platform_user_id)
);

create index if not exists idx_platform_identities_account
  on public.platform_identities (account_id);

-- ---------------------------------------------------------------------
-- link_codes: one-time codes used to attach a second platform identity
-- to an existing account. The code itself is NEVER stored in plaintext —
-- only a SHA-256 hash — mirroring how we'd store a password. Codes
-- expire and are single-use (consumed_at).
-- ---------------------------------------------------------------------
create table if not exists public.link_codes (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  code_hash          text not null,
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists idx_link_codes_expiry
  on public.link_codes (expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------
-- notes: Notion-block-lite. Freeform title/body + optional tags.
-- ---------------------------------------------------------------------
create table if not exists public.notes (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  title              text not null,
  body               text not null default '',
  tags               text[] not null default '{}',
  -- Notion two-way sync bookkeeping. notion_page_id is null until the
  -- note has been pushed to (or pulled from) Notion at least once.
  -- notion_last_synced_edit is the Notion `last_edited_time` we last
  -- saw/wrote — comparing against it is what stops an inbound webhook
  -- from re-importing a change WE just pushed (an infinite sync loop).
  notion_page_id          text,
  notion_last_synced_edit timestamptz,
  -- Optional semantic-search vector (Jina embeddings, 256 dimensions —
  -- see docs/ai-integration.md). Stays null for every note unless
  -- JINA_API_KEY is configured; nothing reads or requires this column
  -- when the feature is off, so enabling/disabling it later is purely
  -- additive and never breaks existing notes.
  embedding          vector(256),
  -- Generated tsvector column powers RAG-style retrieval for the AI
  -- assistant: we look up the few most relevant notes for THIS account
  -- only, via Postgres full-text search, and send only those snippets to
  -- the LLM — never the account's whole note history. This is a
  -- dependency-free, free-tier-friendly alternative to a vector/embedding
  -- pipeline; see docs/ai-integration.md for the pgvector upgrade path.
  search_vector      tsvector,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Trigger to auto-populate search_vector (replaces PG14-style generated
-- column — Supabase's PG15+ marks to_tsvector as STABLE, not IMMUTABLE,
-- which makes generated columns illegal. A before-insert/update trigger
-- achieves the same thing without the immutability constraint.)
create or replace function public.notes_search_vector_trigger()
returns trigger as $f$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.body, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(new.tags, '{}'), ' ')), 'C');
  return new;
end;
$f$ language plpgsql;

drop trigger if exists trg_notes_search_vector on public.notes;
create trigger trg_notes_search_vector
  before insert or update on public.notes
  for each row execute function public.notes_search_vector_trigger();

create index if not exists idx_notes_account on public.notes (account_id, updated_at desc);
create index if not exists idx_notes_search_vector on public.notes using gin (search_vector);
create unique index if not exists idx_notes_notion_page_id on public.notes (notion_page_id) where notion_page_id is not null;

-- ivfflat requires at least a few rows to build meaningful clusters, so
-- this index is safe to create even with zero notes yet (Postgres just
-- builds a trivial one-list index that gets more useful as notes grow).
-- Only rows that actually HAVE an embedding are indexed — accounts that
-- never enable semantic search cost this index nothing.
create index if not exists idx_notes_embedding
  on public.notes using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

-- ---------------------------------------------------------------------
-- tasks: structured to-dos with due dates and completion state.
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  title              text not null,
  due_at             timestamptz,
  completed_at       timestamptz,
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_at         timestamptz not null default now()
);

create index if not exists idx_tasks_account on public.tasks (account_id, completed_at, due_at);

-- ---------------------------------------------------------------------
-- reminders: time-triggered notifications delivered back to whichever
-- platform+identity the user created them from (or all linked identities).
-- status transitions: pending -> sent | failed | cancelled
-- ---------------------------------------------------------------------
create table if not exists public.reminders (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  message            text not null,
  remind_at          timestamptz not null,
  -- 'none' = one-shot (default). Others cause the cron dispatcher to
  -- insert the next occurrence after successfully delivering this one.
  recurrence_rule    text not null default 'none' check (recurrence_rule in ('none', 'daily', 'weekly', 'monthly')),
  status             text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  delivery_attempts  int not null default 0,
  last_error         text,
  -- When true, the dispatcher re-sends this reminder every few minutes
  -- until the user explicitly acknowledges it. Use for important/time-
  -- sensitive alerts that must not be missed.
  is_alarm           boolean not null default false,
  -- Set by the dispatcher on each alarm delivery, used as a cooldown
  -- guard so the same alarm isn't re-sent on every cron tick.
  last_alarm_sent_at timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists idx_reminders_due
  on public.reminders (remind_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- oauth_states: one-time CSRF-protection tokens for the Notion OAuth
-- flow. Chat bots can't natively host a browser redirect, so we bridge
-- it: the bot generates a short-lived state token (SAME hashed-at-rest
-- pattern as link_codes — never stored in plaintext), hands the user a
-- notion.com/oauth/authorize URL containing it, and Notion echoes the
-- state back to our /oauth/notion/callback route, which we validate
-- against this table before exchanging the authorization code.
-- ---------------------------------------------------------------------
create table if not exists public.oauth_states (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  provider           text not null check (provider in ('notion')),
  state_hash         text not null,
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists idx_oauth_states_expiry
  on public.oauth_states (expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------
-- notion_connections: one row per account that has connected a Notion
-- workspace + database. access_token_encrypted is a real, REUSABLE
-- credential (unlike link_codes, which are one-time and hashed) — it
-- must be decryptable, so it's encrypted with AES-256-GCM using a
-- server-held key (NOTION_TOKEN_ENCRYPTION_KEY), never stored or logged
-- in plaintext. This mirrors exactly how a production system would
-- store, say, a Stripe Connect access token.
-- ---------------------------------------------------------------------
create table if not exists public.notion_connections (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  workspace_id             text not null,
  workspace_name           text,
  access_token_encrypted   text not null,
  -- IV + auth tag for AES-256-GCM, needed to decrypt the token above.
  access_token_iv          text not null,
  access_token_auth_tag    text not null,
  database_id              text,
  webhook_verification_status text not null default 'pending' check (webhook_verification_status in ('pending', 'verified')),
  connected_at             timestamptz not null default now(),
  unique (account_id, workspace_id)
);

create index if not exists idx_notion_connections_workspace
  on public.notion_connections (workspace_id);

-- ---------------------------------------------------------------------
-- notion_webhook_events: idempotency guard. Notion explicitly documents
-- that webhook deliveries can be retried, so every event's `id` is
-- recorded here before processing; a duplicate delivery is a no-op
-- rather than a double-import.
-- ---------------------------------------------------------------------
create table if not exists public.notion_webhook_events (
  event_id           text primary key,
  received_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- activity_log: append-only counters used for the "chart my week" /
-- "chart my tasks" feature. Kept intentionally tiny (no PII in payload).
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  kind               text not null check (kind in ('note_created', 'task_created', 'task_completed', 'reminder_created', 'reminder_sent')),
  occurred_at        timestamptz not null default now()
);

create index if not exists idx_activity_account_time
  on public.activity_log (account_id, occurred_at);

-- ---------------------------------------------------------------------
-- conversation_history: persistent per-account chat memory. Stores raw
-- exchanges so the AI can see recent conversation context across cold
-- starts. Old rows are periodically summarized into notes (see
-- conversationSummaryService.ts) and then pruned to keep the table lean.
-- ---------------------------------------------------------------------
create table if not exists public.conversation_history (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  text          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_conversation_history_account
  on public.conversation_history (account_id, created_at desc);

-- ---------------------------------------------------------------------
-- RAG retrieval function: returns the top-N notes for ONE account,
-- ranked by relevance to a query. The account_id filter is baked into
-- the function body (not just passed as an application-side WHERE
-- clause), so even a bug in a calling service can't accidentally widen
-- the scope to another account's notes.
-- ---------------------------------------------------------------------
create or replace function public.search_notes_for_account(
  p_account_id uuid,
  p_query text,
  p_limit int default 5
)
returns table (
  id uuid,
  title text,
  body text,
  rank real
)
language sql
stable
as $$
  select n.id, n.title, n.body, ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from public.notes n
  where n.account_id = p_account_id
    and n.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit greatest(p_limit, 1);
$$;

-- ---------------------------------------------------------------------
-- Semantic search (optional, only meaningful once notes have an
-- embedding populated — see docs/ai-integration.md). Same account-
-- scoping discipline as search_notes_for_account: the account_id
-- filter is baked into the SQL itself, not left to application code to
-- remember. Uses cosine distance (<=>), matching the ivfflat index
-- above and the L2-normalized embeddings requested from Jina.
-- ---------------------------------------------------------------------
create or replace function public.semantic_search_notes_for_account(
  p_account_id uuid,
  p_query_embedding vector(256),
  p_limit int default 5
)
returns table (
  id uuid,
  title text,
  body text,
  similarity real
)
language sql
stable
as $$
  select n.id, n.title, n.body, (1 - (n.embedding <=> p_query_embedding))::real as similarity
  from public.notes n
  where n.account_id = p_account_id
    and n.embedding is not null
  order by n.embedding <=> p_query_embedding
  limit greatest(p_limit, 1);
$$;

-- ---------------------------------------------------------------------
-- Daily digest eligibility: rather than pull EVERY account on every
-- cron tick and compute local-time logic in application code, we push
-- the "is it currently this account's chosen digest hour, in their own
-- timezone" comparison into SQL, so it's a single indexed query instead
-- of an N-account fan-out. Still account-scoped by construction: this
-- returns account ids only, never other accounts' note/task content.
-- ---------------------------------------------------------------------
create or replace function public.accounts_due_for_digest()
returns table (account_id uuid, timezone text)
language sql
stable
as $$
  select a.id, a.timezone
  from public.accounts a
  where a.digest_enabled = true
    and extract(hour from (now() at time zone a.timezone))::int = a.digest_hour
    and (
      a.last_digest_sent_date is null
      or a.last_digest_sent_date <> to_char(now() at time zone a.timezone, 'YYYY-MM-DD')
    );
$$;

-- ---------------------------------------------------------------------
-- Row Level Security — enabled on every table, defense-in-depth.
-- These policies assume a future `auth.uid()` maps 1:1 to accounts.id
-- via a `user_accounts` bridge; until a browser login exists, only the
-- service role (which bypasses RLS) can read/write, which is correct:
-- bots never hold a Supabase Auth session.
-- ---------------------------------------------------------------------
alter table public.accounts            enable row level security;
alter table public.platform_identities enable row level security;
alter table public.link_codes          enable row level security;
alter table public.notes               enable row level security;
alter table public.tasks               enable row level security;
alter table public.reminders           enable row level security;
alter table public.activity_log        enable row level security;
alter table public.oauth_states        enable row level security;
alter table public.notion_connections  enable row level security;
alter table public.notion_webhook_events enable row level security;
alter table public.conversation_history   enable row level security;

-- No policies are created for anon/authenticated roles yet — this means
-- those roles get ZERO access by default (RLS fails closed), which is
-- the correct posture: the only client of this database today is the
-- trusted server using the service role key.

-- ---------------------------------------------------------------------
-- Storage: user-owned-files-only.
-- Run this once you've created the "user-attachments" bucket (Storage ->
-- New bucket -> keep it PRIVATE, not public). Objects are always
-- uploaded with a key prefixed "<account_id>/...".
--
-- Today, only the service role writes/reads (via our server), which
-- already bypasses these policies — but they matter the moment this
-- bucket is ever reachable with a user's own Supabase Auth JWT (e.g. a
-- future web dashboard), which is exactly the "no exposed credentials /
-- no cross-user file access" guarantee the spec requires.
-- ---------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('user-attachments', 'user-attachments', false)
--   on conflict (id) do nothing;

-- create policy "Users read only their own attachments"
--   on storage.objects for select
--   using (
--     bucket_id = 'user-attachments'
--     and (storage.foldername(name))[1] = auth.uid()::text
--   );

-- create policy "Users write only into their own folder"
--   on storage.objects for insert
--   with check (
--     bucket_id = 'user-attachments'
--     and (storage.foldername(name))[1] = auth.uid()::text
--   );

-- ---------------------------------------------------------------------
-- Scheduled dispatcher: every minute, ask our API to deliver any due
-- reminders. This lives OUTSIDE the Render dyno so it keeps firing even
-- if the free-tier instance has gone to sleep — the call itself wakes it.
-- Replace the URL + secret below with your deployed values before running.
-- ---------------------------------------------------------------------
-- select cron.schedule(
--   'dispatch-reminders-every-minute',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url := 'https://YOUR-RENDER-SERVICE.onrender.com/internal/cron/dispatch',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'X-Internal-Cron-Secret', 'PASTE_INTERNAL_CRON_SECRET_HERE'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- ---------------------------------------------------------------------
-- Daily digest dispatcher: runs on a coarser schedule than reminders
-- (digest is hour-granular, not minute-granular — see accounts_due_for_
-- digest above), calling a separate route guarded by the same shared
-- cron secret. Every 15 minutes comfortably catches each account's
-- chosen hour without excessive load.
-- ---------------------------------------------------------------------
-- select cron.schedule(
--   'dispatch-daily-digest-every-15-minutes',
--   '*/15 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://YOUR-RENDER-SERVICE.onrender.com/internal/cron/digest',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'X-Internal-Cron-Secret', 'PASTE_INTERNAL_CRON_SECRET_HERE'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
