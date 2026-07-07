import { Router } from "express";
import { consumeOAuthState, saveNotionConnection } from "../services/notionConnectionService.js";
import { exchangeNotionCode } from "../services/notionClient.js";
import { env, isNotionConfigured } from "../config/env.js";
import { logError, logger } from "../lib/logger.js";
export const notionOAuthRouter = Router();
/**
 * This is the ONE genuinely browser-facing route in the whole service
 * (every other route is server-to-server). It exists only because a
 * chat bot cannot itself perform an OAuth redirect — the user opens the
 * link we gave them (see commandHandler's "notion connect"), Notion
 * redirects their browser here after they approve access, and we
 * complete the token exchange server-side.
 *
 * Security notes:
 *   - `state` is validated against oauth_states (single-use, hashed at
 *     rest, expires in 10 minutes) — this is the CSRF protection for the
 *     whole flow. A forged callback request without a valid, unconsumed
 *     state is rejected before any token exchange happens.
 *   - The authorization `code` is exchanged for a token immediately and
 *     is never itself stored — only the resulting access token is
 *     persisted, and only in encrypted form (see tokenCrypto.ts).
 *   - This route deliberately returns plain, minimal HTML (no external
 *     scripts/styles/CDNs) since it's rendered directly in the user's
 *     browser and this is the one place in the codebase where XSS is a
 *     real concern — every value interpolated below is either a fixed
 *     string or comes from Notion's own redirect, never raw user input.
 */
notionOAuthRouter.get("/oauth/notion/callback", async (req, res) => {
    if (!isNotionConfigured) {
        return res.status(503).send(renderHtmlPage("Notion sync isn't configured on this server."));
    }
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const oauthError = typeof req.query.error === "string" ? req.query.error : undefined;
    if (oauthError) {
        return res.status(400).send(renderHtmlPage("Notion connection was cancelled or denied. You can close this tab and try again from the bot."));
    }
    if (!code || !state) {
        return res.status(400).send(renderHtmlPage("Missing authorization details. Please restart the connection from the bot."));
    }
    try {
        const stateResult = await consumeOAuthState(state);
        if (!stateResult.ok) {
            return res.status(400).send(renderHtmlPage("This connection link is invalid or has expired. Please restart from the bot."));
        }
        const redirectUri = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/oauth/notion/callback`;
        const tokenResult = await exchangeNotionCode(code, redirectUri, env.NOTION_OAUTH_CLIENT_ID, env.NOTION_OAUTH_CLIENT_SECRET);
        if (!tokenResult.ok || !tokenResult.data) {
            logger.warn({ context: "notionOAuthRoute" }, "token_exchange_failed");
            return res.status(502).send(renderHtmlPage("Could not complete the Notion connection. Please try again from the bot."));
        }
        const saveResult = await saveNotionConnection(stateResult.data.accountId, tokenResult.data.workspace_id, tokenResult.data.workspace_name, tokenResult.data.access_token);
        if (!saveResult.ok) {
            return res.status(500).send(renderHtmlPage("Connected to Notion, but we couldn't save the connection. Please try again."));
        }
        return res
            .status(200)
            .send(renderHtmlPage("Notion connected! Go back to the bot and send: notion database <the id of the database you want to sync notes to>."));
    }
    catch (err) {
        logError("notionOAuthRoute.callback", err);
        return res.status(500).send(renderHtmlPage("Something went wrong completing the connection. Please try again from the bot."));
    }
});
function renderHtmlPage(message) {
    const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Notion Connection</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; text-align: center; color: #222;">
  <p>${escaped}</p>
</body>
</html>`;
}
//# sourceMappingURL=notionOAuthRoute.js.map