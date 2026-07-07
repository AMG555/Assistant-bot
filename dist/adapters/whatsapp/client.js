import { env } from "../../config/env.js";
import { logError } from "../../lib/logger.js";
const GRAPH_BASE = "https://graph.facebook.com/v20.0";
/** Resolves a WhatsApp media id into a downloadable Buffer. Meta's Cloud
 * API requires two authenticated steps: look up the temporary media URL
 * by id, then fetch that URL with the same bearer token. Returns null
 * on any failure rather than throwing. */
export async function downloadWhatsAppMedia(mediaId) {
    try {
        const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
            headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
        });
        if (!metaRes.ok)
            throw new Error(`media lookup failed: ${metaRes.status}`);
        const meta = (await metaRes.json());
        if (!meta.url)
            throw new Error("media lookup returned no url");
        const fileRes = await fetch(meta.url, {
            headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
        });
        if (!fileRes.ok)
            throw new Error(`media download failed: ${fileRes.status}`);
        const arrayBuffer = await fileRes.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    catch (err) {
        logError("whatsapp.downloadWhatsAppMedia", err);
        return null;
    }
}
export async function sendWhatsAppText(toPhone, text) {
    try {
        const res = await fetch(`${GRAPH_BASE}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: toPhone,
                type: "text",
                text: { body: text },
            }),
        });
        if (!res.ok)
            throw new Error(`WhatsApp send failed: ${res.status}`);
        return true;
    }
    catch (err) {
        logError("whatsapp.sendWhatsAppText", err);
        return false;
    }
}
//# sourceMappingURL=client.js.map