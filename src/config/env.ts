import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Loaded explicitly (rather than the `dotenv/config` side-effect import)
// so we can pass `quiet: true` — dotenv v17+ otherwise prints an
// informational "X keys loaded" line on every boot by default, which is
// exactly the kind of chatty startup log this project's logging
// standard explicitly avoids (see src/lib/logger.ts).
loadDotenv({ quiet: true });

/**
 * All environment access in the entire codebase MUST go through this
 * module. Nothing reads `process.env` directly anywhere else — this is
 * the single choke point that guarantees:
 *   1. Missing/malformed secrets crash fast at boot (fail closed), not
 *      mid-request with a confusing downstream error.
 *   2. Secrets never leak into logs (we never log this object as-is).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(10000),
  ALLOWED_ORIGINS: z
    .string()
    .min(1, "ALLOWED_ORIGINS must list at least one origin")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("user-attachments"),
  SUPABASE_DB_URL: z.string().optional().default(""),

  INTERNAL_CRON_SECRET: z.string().min(16, "INTERNAL_CRON_SECRET must be at least 16 chars"),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z.string().url(),

  DISCORD_APP_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),

  // WhatsApp is intentionally optional — the adapter self-disables
  // (returns 503) rather than silently pretending to work when unset.
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(""),

  LINK_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // Optional — see isGroqConfigured below. Blank key means the AI layer
  // never activates, regardless of any per-account opt-in.
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
  GROQ_MAX_CALLS_PER_HOUR: z.coerce.number().int().positive().default(30),

  // Notion sync is fully optional — see isNotionConfigured below. If
  // NOTION_TOKEN_ENCRYPTION_KEY is set but malformed (not 64 hex chars),
  // we fail fast at boot rather than silently storing tokens with a
  // broken key that can never decrypt them later.
  NOTION_OAUTH_CLIENT_ID: z.string().optional().default(""),
  NOTION_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  NOTION_WEBHOOK_SECRET: z.string().optional().default(""),
  NOTION_TOKEN_ENCRYPTION_KEY: z
    .string()
    .optional()
    .default("")
    .refine((v) => v === "" || /^[0-9a-fA-F]{64}$/.test(v), "NOTION_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  NOTION_MAX_REQUESTS_PER_SECOND: z.coerce.number().positive().default(2),
  NOTION_API_VERSION: z.string().min(1).default("2025-09-03"),
  OAUTH_STATE_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // Optional real semantic search (vs. the always-on Postgres full-text
  // search). Blank key means semantic search is silently unavailable —
  // "ask" and "note search" fall back to full-text search, never error.
  // IMPORTANT: Jina's free-tier embedding models are CC-BY-NC licensed
  // (non-commercial use only as of this writing) — see
  // docs/ai-integration.md before enabling this on anything but a
  // personal, non-commercial deployment.
  JINA_API_KEY: z.string().optional().default(""),
  JINA_EMBEDDING_MODEL: z.string().min(1).default("jina-embeddings-v3"),
  JINA_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(256),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally does not use the app logger — logger construction may
  // itself depend on env. Structured, non-sensitive output only: we
  // print which keys failed, never any value.
  const missingKeys = parsed.error.issues.map((issue) => issue.path.join("."));
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "Invalid or missing environment configuration",
      invalidKeys: missingKeys,
    })
  );
  process.exit(1);
}

export const env = parsed.data;

export const isWhatsAppConfigured = Boolean(
  env.WHATSAPP_APP_SECRET &&
    env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    env.WHATSAPP_VERIFY_TOKEN
);

/** AI features require BOTH a server-level key AND a per-account
 * opt-in (accounts.ai_enabled). This flag only reflects the former. */
export const isGroqConfigured = Boolean(env.GROQ_API_KEY);

/** Notion sync requires the OAuth app credentials and the token
 * encryption key. The webhook secret is checked separately by the
 * webhook route itself (a workspace can complete OAuth before the
 * operator has finished setting up the webhook subscription). */
export const isNotionConfigured = Boolean(
  env.NOTION_OAUTH_CLIENT_ID && env.NOTION_OAUTH_CLIENT_SECRET && env.NOTION_TOKEN_ENCRYPTION_KEY
);

/** Real semantic search (vector similarity) requires a Jina API key.
 * When false, callers must fall back to the always-available Postgres
 * full-text search — never error out entirely. */
export const isSemanticSearchConfigured = Boolean(env.JINA_API_KEY);
