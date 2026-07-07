import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger, logError } from "./lib/logger.js";
import { telegramRouter } from "./adapters/telegram/webhookRoute.js";
import { discordRouter } from "./adapters/discord/webhookRoute.js";
import { whatsappRouter } from "./adapters/whatsapp/webhookRoute.js";
import { cronRouter } from "./routes/cronDispatchRoute.js";
import { digestRouter } from "./routes/digestDispatchRoute.js";
import { notionOAuthRouter } from "./routes/notionOAuthRoute.js";
import { notionWebhookRouter } from "./routes/notionWebhookRoute.js";
import { webhookIncomingRouter } from "./routes/webhookIncomingRoute.js";
import { runMigrations } from "./lib/migrate.js";

const app = express();

// Render (and most PaaS) sit behind a reverse proxy; without this,
// rate limiting / IP-based logic would see the proxy's IP, not the
// caller's.
app.set("trust proxy", 1);

app.use(helmet());

/**
 * CORS is intentionally strict and origin-allowlisted. Nothing in this
 * service is meant to be called from an arbitrary browser origin — the
 * only "browser-facing" surface is the health/status route. Bot
 * webhooks are server-to-server and are authenticated by signature
 * verification, not CORS, since CORS is a browser-enforced concept and
 * provides no protection against a server-to-server forged request.
 */
app.use(
  cors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  })
);

// Capture the raw request body BEFORE JSON parsing, because Discord's
// Ed25519 signature and WhatsApp's HMAC signature are both computed
// over the exact raw bytes Meta/Discord sent — re-serializing parsed
// JSON would produce a different byte sequence and break verification.
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
    limit: "1mb",
  })
);

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === "/healthz" || req.url === "/keepalive",
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    redact: ["req.headers.authorization"],
  })
);

app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: "personal-assistant-bot" });
});

/**
 * Dedicated keep-alive target for an external uptime monitor (e.g.
 * UptimeRobot's free HTTP monitor, checked every 5 minutes). Kept
 * separate from /healthz so:
 *   - it's trivially cheap (no timers/state to compute),
 *   - it never appears in request logs (pure noise otherwise, since it
 *     fires ~288 times/day forever), and
 *   - if you ever want to stop external keep-alive pings without
 *     touching your real health-check tooling, you only remove this one
 *     route.
 * This does NOT replace the pg_cron reminder dispatcher — it only keeps
 * the dyno warm for faster interactive chat responses. Reminder timing
 * correctness still relies on Supabase pg_cron calling
 * /internal/cron/dispatch on its own schedule, independent of whether
 * this endpoint has been pinged recently.
 */
app.get("/keepalive", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

app.use("/telegram", telegramRouter);
app.use("/discord", discordRouter);
app.use("/whatsapp", whatsappRouter);
app.use("/", cronRouter);
app.use("/", digestRouter);
app.use("/", notionOAuthRouter);
app.use("/", notionWebhookRouter);
app.use("/", webhookIncomingRouter);

// 404 fallback — explicit, not silent.
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

/**
 * Global error boundary for the whole HTTP surface. This is the
 * server-side equivalent of a React Error Boundary: no single failing
 * handler can crash the process or leak a stack trace to a caller.
 * Detailed errors go to structured logs only; the caller always gets a
 * generic, safe message.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logError("expressGlobalErrorHandler", err, { path: req.path, method: req.method });
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_server_error" });
});

process.on("unhandledRejection", (reason) => {
  logError("process.unhandledRejection", reason);
});

process.on("uncaughtException", (err) => {
  logError("process.uncaughtException", err);
  // Fail fast rather than continue in a possibly-corrupted state; the
  // platform (Render) will restart the process automatically.
  process.exit(1);
});

const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "server_started");
  runMigrations().catch(() => {});
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutdown_initiated");
  server.close(() => {
    logger.info({}, "shutdown_complete");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
