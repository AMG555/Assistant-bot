import { logError } from "../../lib/logger.js";
const API_BASE = "https://discord.com/api/v10";
/** Sends a follow-up message to a deferred interaction. Used when a
 * command needs slower work (DB + chart render) than Discord's 3s
 * initial-response deadline allows. */
export async function sendDiscordFollowup(applicationId, interactionToken, payload) {
    try {
        const url = `${API_BASE}/webhooks/${applicationId}/${interactionToken}`;
        if (payload.files?.length) {
            const form = new FormData();
            form.append("payload_json", JSON.stringify({ content: payload.content ?? "" }));
            payload.files.forEach((f, idx) => {
                form.append(`files[${idx}]`, new Blob([f.buffer], { type: "image/png" }), f.name);
            });
            const res = await fetch(url, { method: "POST", body: form });
            if (!res.ok)
                throw new Error(`Discord followup (file) failed: ${res.status}`);
            return true;
        }
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: payload.content ?? "" }),
        });
        if (!res.ok)
            throw new Error(`Discord followup failed: ${res.status}`);
        return true;
    }
    catch (err) {
        logError("discord.sendDiscordFollowup", err);
        return false;
    }
}
//# sourceMappingURL=client.js.map