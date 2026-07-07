/**
 * Populates a complete, valid-shaped (but entirely fake) set of
 * environment variables BEFORE any test file imports src/config/env.ts.
 * That module validates process.env at import time and calls
 * process.exit(1) on failure — necessary in production (fail fast on
 * misconfiguration), but it means every test run needs a syntactically
 * valid env even though no test in this suite ever makes a real network
 * call to any of these services.
 *
 * IMPORTANT: none of these values are real credentials. They exist only
 * to satisfy Zod's shape/format checks (e.g. SUPABASE_URL must be a
 * valid URL, NOTION_TOKEN_ENCRYPTION_KEY must be 64 hex chars) so that
 * modules importing config/env.ts don't crash on import during tests.
 */
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "10000";
process.env.ALLOWED_ORIGINS ??= "https://myapp.example";

process.env.SUPABASE_URL ??= "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "fake-service-role-key-for-tests-only";
process.env.SUPABASE_STORAGE_BUCKET ??= "user-attachments";

process.env.INTERNAL_CRON_SECRET ??= "fake-cron-secret-32-chars-long!!";

process.env.TELEGRAM_BOT_TOKEN ??= "123456:fake-telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET ??= "fake-telegram-webhook-secret";
process.env.PUBLIC_BASE_URL ??= "https://fake-app.onrender.com";

process.env.DISCORD_APP_ID ??= "fake-discord-app-id";
process.env.DISCORD_PUBLIC_KEY ??= "fake-discord-public-key";
process.env.DISCORD_BOT_TOKEN ??= "fake-discord-bot-token";

// Deliberately left blank, mirroring a real deployment that hasn't
// configured these optional integrations — several tests exercise the
// "not configured" fail-closed behavior of isWhatsAppConfigured /
// isGroqConfigured / isNotionConfigured.
process.env.WHATSAPP_APP_SECRET ??= "";
process.env.WHATSAPP_ACCESS_TOKEN ??= "";
process.env.WHATSAPP_PHONE_NUMBER_ID ??= "";
process.env.WHATSAPP_VERIFY_TOKEN ??= "";

process.env.GROQ_API_KEY ??= "";

// A syntactically valid (64 hex chars) but fake AES-256-GCM key, needed
// so tokenCrypto.ts tests can actually encrypt/decrypt. This is NOT a
// real secret and must never be reused outside this test file.
process.env.NOTION_TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Deliberately left blank — tests confirm fail-closed behavior.
process.env.JINA_API_KEY ??= "";
process.env.JINA_EMBEDDING_DIMENSIONS ??= "256";

process.env.NOTION_OAUTH_CLIENT_ID ??= "";
process.env.NOTION_OAUTH_CLIENT_SECRET ??= "";
process.env.NOTION_WEBHOOK_SECRET ??= "";
process.env.NOTION_MAX_REQUESTS_PER_SECOND ??= "50"; // fast in tests, no real API to throttle
