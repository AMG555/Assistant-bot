import { env } from "../../config/env.js";
import { logError } from "../../lib/logger.js";

const API_BASE = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

async function callTelegram(method: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Telegram API ${method} failed: ${res.status} ${errBody.slice(0, 200)}`);
    }
    return true;
  } catch (err) {
    logError("telegram.callTelegram", err, { method });
    return false;
  }
}

export async function sendTelegramMessage(chatId: string | number, text: string, parseMode?: "HTML" | "Markdown"): Promise<boolean> {
  const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (parseMode) body.parse_mode = parseMode;
  return callTelegram("sendMessage", body);
}

/** Resolves a Telegram file_id into a downloadable Buffer. Telegram's
 * getFile only returns a relative path valid for a short time — this
 * wraps both steps (resolve path, then download bytes) into one call so
 * callers never handle a stale/expired path themselves. Returns null on
 * any failure rather than throwing, consistent with this file's other
 * network calls. */
export async function downloadTelegramFile(fileId: string): Promise<Buffer | null> {
  try {
    const metaRes = await fetch(`${API_BASE}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!metaRes.ok) throw new Error(`getFile failed: ${metaRes.status}`);
    const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = meta.result?.file_path;
    if (!meta.ok || !filePath) throw new Error("getFile returned no file_path");

    const fileRes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
    if (!fileRes.ok) throw new Error(`file download failed: ${fileRes.status}`);

    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    logError("telegram.downloadTelegramFile", err);
    return null;
  }
}

export async function sendTelegramPhoto(chatId: string | number, buffer: Buffer, caption: string): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("photo", new Blob([buffer], { type: "image/png" }), "chart.png");

    const res = await fetch(`${API_BASE}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Telegram sendPhoto failed: ${res.status} ${errBody.slice(0, 200)}`);
    }
    return true;
  } catch (err) {
    logError("telegram.sendTelegramPhoto", err);
    return false;
  }
}
