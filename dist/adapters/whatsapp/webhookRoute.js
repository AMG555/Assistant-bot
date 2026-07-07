import { Router } from "express";
import { verifyWhatsAppWebhook } from "../../middleware/verifyWhatsApp.js";
import { handleCommand } from "../../router/commandHandler.js";
import { sendWhatsAppText, downloadWhatsAppMedia } from "./client.js";
import { env, isWhatsAppConfigured, isGroqConfigured } from "../../config/env.js";
import { logError, logger } from "../../lib/logger.js";
import { checkRateLimit } from "../../middleware/rateLimit.js";
import { isAiEnabledForAccount, resolveOrCreateAccount } from "../../services/accountService.js";
import { transcribeAudio } from "../../services/aiService.js";
export const whatsappRouter = Router();
/**
 * Meta's one-time GET verification handshake, required when you first
 * register the webhook URL in the Meta Developer console. This is
 * intentionally the ONLY unauthenticated endpoint in this adapter, and
 * it only ever echoes a challenge back — it never touches user data.
 */
whatsappRouter.get("/webhook", (req, res) => {
    if (!isWhatsAppConfigured)
        return res.status(503).send("whatsapp_adapter_disabled");
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(String(challenge ?? ""));
    }
    return res.status(403).send("verification_failed");
});
whatsappRouter.post("/webhook", verifyWhatsAppWebhook, async (req, res) => {
    res.status(200).json({ received: true });
    const body = req.body;
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const audioMediaId = message?.audio?.id;
    if (!message || (!message.text?.body && !audioMediaId))
        return;
    const fromPhone = message.from;
    const displayName = value?.contacts?.[0]?.profile?.name;
    try {
        if (!checkRateLimit(`whatsapp:${fromPhone}`, 20, 60_000)) {
            await sendWhatsAppText(fromPhone, "You're sending messages too quickly. Please slow down a bit.");
            return;
        }
        let inputText = message.text?.body;
        let resolvedAccountId;
        if (!inputText && audioMediaId) {
            const transcribed = await transcribeVoiceMessage(fromPhone, displayName, audioMediaId);
            if (transcribed === null)
                return; // a reply was already sent (or nothing to do)
            inputText = transcribed.text;
            resolvedAccountId = transcribed.accountId;
        }
        if (!inputText)
            return;
        const reply = await handleCommand({
            platform: "whatsapp",
            platformUserId: fromPhone,
            displayName,
            text: inputText,
            resolvedAccountId,
        });
        // WhatsApp Cloud API text messages don't support inline binary
        // images the way Telegram/Discord do without a two-step media
        // upload; for v1 we degrade charts to a text summary rather than
        // silently dropping the reply.
        const outgoingText = reply.kind === "text" ? reply.text : `${reply.caption} (charts on WhatsApp are text-only for now — try Telegram or Discord for the image.)`;
        const delivered = await sendWhatsAppText(fromPhone, outgoingText);
        if (!delivered)
            logger.warn({ context: "whatsappRouter" }, "message_delivery_failed");
    }
    catch (err) {
        logError("whatsappRouter.webhook", err);
        await sendWhatsAppText(fromPhone, "Something went wrong handling that. Please try again.").catch(() => { });
    }
});
/** Mirrors the Telegram voice-note handler: same two-layer AI opt-in
 * gate (server config + per-account ai_enabled), same fail-safe replies
 * on any failure instead of a silent drop. */
async function transcribeVoiceMessage(fromPhone, displayName, mediaId) {
    if (!isGroqConfigured) {
        await sendWhatsAppText(fromPhone, "Voice messages need AI features enabled on this server. Please type your message instead.");
        return null;
    }
    const accountResult = await resolveOrCreateAccount("whatsapp", fromPhone, displayName);
    if (!accountResult.ok) {
        await sendWhatsAppText(fromPhone, "Sorry — I couldn't reach your account storage. Please try again in a moment.");
        return null;
    }
    const accountId = accountResult.data.accountId;
    if (!(await isAiEnabledForAccount(accountId))) {
        await sendWhatsAppText(fromPhone, 'Voice messages require AI to be on for your account. Send "ai on" first, or type your message instead.');
        return null;
    }
    const audioBuffer = await downloadWhatsAppMedia(mediaId);
    if (!audioBuffer) {
        await sendWhatsAppText(fromPhone, "I couldn't download that voice message. Please try again or type it instead.");
        return null;
    }
    const transcription = await transcribeAudio(accountId, audioBuffer, "voice.ogg");
    if (!transcription.ok) {
        const reason = transcription.reason === "rate_limited"
            ? "You've sent a lot of voice messages recently — please try again in a bit, or type your message."
            : "I couldn't transcribe that voice message. Please try again or type it instead.";
        await sendWhatsAppText(fromPhone, reason);
        return null;
    }
    return { text: transcription.text, accountId };
}
//# sourceMappingURL=webhookRoute.js.map