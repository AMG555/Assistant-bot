import { env } from "../config/env.js";
import { throttleNotionCall } from "../lib/notionThrottle.js";
import { logError } from "../lib/logger.js";
const NOTION_API_BASE = "https://api.notion.com/v1";
/** Builds the browser URL we hand the user to approve access. Chat bots
 * can't natively perform a redirect themselves — this is the bridge:
 * the user opens this link in their own browser, approves access, and
 * Notion redirects them to our /oauth/notion/callback route with a
 * one-time authorization code plus the state we embedded here. */
export function buildNotionAuthorizeUrl(clientId, redirectUri, state) {
    const url = new URL("https://api.notion.com/v1/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("state", state);
    return url.toString();
}
/**
 * Thin, throttled wrapper around Notion's REST API. Every call goes
 * through throttleNotionCall so the shared 3 req/sec-per-integration
 * ceiling (see notionThrottle.ts) is respected across every connected
 * workspace, not just per-account.
 */
async function notionRequest(accessToken, path, init = {}) {
    return throttleNotionCall(async () => {
        try {
            const res = await fetch(`${NOTION_API_BASE}${path}`, {
                ...init,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Notion-Version": env.NOTION_API_VERSION,
                    "Content-Type": "application/json",
                    ...init.headers,
                },
            });
            const body = (await res.json().catch(() => undefined));
            if (!res.ok) {
                return { ok: false, status: res.status, error: body?.message ?? `Notion API error ${res.status}` };
            }
            return { ok: true, status: res.status, data: body };
        }
        catch (err) {
            logError("notionClient.notionRequest", err, { path });
            return { ok: false, status: 0, error: "network_error" };
        }
    });
}
/** Exchanges an OAuth authorization code for an access token. Called
 * once, from the callback route, immediately after the user approves
 * access in their browser. */
export async function exchangeNotionCode(code, redirectUri, clientId, clientSecret) {
    return throttleNotionCall(async () => {
        try {
            const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
            const res = await fetch(`${NOTION_API_BASE}/oauth/token`, {
                method: "POST",
                headers: {
                    Authorization: `Basic ${basicAuth}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
            });
            const body = (await res.json().catch(() => undefined));
            if (!res.ok) {
                return { ok: false, status: res.status, error: body?.error_description ?? "oauth_exchange_failed" };
            }
            return { ok: true, status: res.status, data: body };
        }
        catch (err) {
            logError("notionClient.exchangeNotionCode", err);
            return { ok: false, status: 0, error: "network_error" };
        }
    });
}
/** Creates a new page (row) in the user's designated Notion database,
 * representing one bot note. Notion property names are assumed to
 * follow the schema documented in docs/notion-sync.md ("Name" title
 * property, "Body" rich text). */
export async function createNotionPage(accessToken, databaseId, title, body) {
    return notionRequest(accessToken, "/pages", {
        method: "POST",
        body: JSON.stringify({
            parent: { database_id: databaseId },
            properties: {
                Name: { title: [{ text: { content: title.slice(0, 2000) } }] },
                Body: { rich_text: [{ text: { content: body.slice(0, 2000) } }] },
            },
        }),
    });
}
/** Updates an existing Notion page's title/body to reflect a bot-side
 * edit. */
export async function updateNotionPage(accessToken, pageId, title, body) {
    return notionRequest(accessToken, `/pages/${pageId}`, {
        method: "PATCH",
        body: JSON.stringify({
            properties: {
                Name: { title: [{ text: { content: title.slice(0, 2000) } }] },
                Body: { rich_text: [{ text: { content: body.slice(0, 2000) } }] },
            },
        }),
    });
}
/** Fetches a page's current title/body/last_edited_time — used when an
 * inbound webhook tells us a page changed, so we pull the fresh content
 * rather than trusting the webhook payload itself to carry full data
 * (Notion's webhook events are notifications, not full snapshots). */
export async function getNotionPage(accessToken, pageId) {
    return notionRequest(accessToken, `/pages/${pageId}`);
}
/** Extracts plain-text title/body out of Notion's verbose property
 * shape, matching the "Name" / "Body" schema documented in
 * docs/notion-sync.md. Returns empty strings rather than throwing if
 * the shape doesn't match — a user who renamed their properties should
 * get a degraded sync, not a crash. */
export function extractTitleAndBody(properties) {
    const titleProp = properties?.Name;
    const bodyProp = properties?.Body;
    const title = (titleProp?.title ?? []).map((t) => t.plain_text ?? "").join("");
    const body = (bodyProp?.rich_text ?? []).map((t) => t.plain_text ?? "").join("");
    return { title, body };
}
//# sourceMappingURL=notionClient.js.map