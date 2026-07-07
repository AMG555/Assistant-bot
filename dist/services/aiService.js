import { toFile } from "groq-sdk";
import { env } from "../config/env.js";
import { groqClient } from "./groqClient.js";
import { logError, logger } from "../lib/logger.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { retrieveRelevantNotes } from "./ragService.js";
import { createNoteSchema, createTaskSchema, createReminderSchema, safeValidate, } from "../validation/schemas.js";
const TOOLS = [
    {
        type: "function",
        function: {
            name: "create_note",
            description: "Save a note when the user wants to write something down for later, or tells you personal information about themselves or about you that you should remember.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Short title for the note" },
                    body: { type: "string", description: "The note content" },
                },
                required: ["title", "body"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_task",
            description: "Add a to-do item when the user wants to track something they need to do.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "What needs to be done" },
                    dueAtIso: {
                        type: "string",
                        description: "ISO-8601 due date/time if the user mentioned one, otherwise omit",
                    },
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_reminder",
            description: "Schedule a reminder when the user wants to be reminded of something at a specific future time.",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "What to remind the user about" },
                    remindAtIso: { type: "string", description: "ISO-8601 timestamp of when to send the reminder" },
                    recurrence: {
                        type: "string",
                        enum: ["none", "daily", "weekly", "monthly"],
                        description: "If the user said 'every day'/'every week'/'every month', use that value; otherwise 'none' for a one-time reminder.",
                    },
                },
                required: ["message", "remindAtIso"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_alarm",
            description: "Schedule an important/persistent alarm that keeps repeating every few minutes until acknowledged. Use when the user says 'alarm', 'alarm me', 'wake me up', or anything time-sensitive they must not miss.",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "What to alarm the user about" },
                    remindAtIso: { type: "string", description: "ISO-8601 timestamp of when to fire the alarm" },
                },
                required: ["message", "remindAtIso"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "answer_question",
            description: "Answer a question using the conversation history and relevant notes. Give a natural, direct answer — don't say 'according to your notes' unless it's relevant.",
            parameters: {
                type: "object",
                properties: {
                    answer: { type: "string", description: "A concise, direct answer grounded in the given context" },
                },
                required: ["answer"],
            },
        },
    },
];
const SYSTEM_PROMPT = [
    "You are a friendly personal assistant. Always respond as a human would speak.",
    "",
    "RULES:",
    "1. When the user says 'I am your boss' or similar, call create_note with title 'Amg is the boss' and body ''. Then respond naturally: 'Got it, boss!' or 'You're the boss!'. NEVER respond 'Hello, I'm ready to assist' — treat it as a statement of fact, not a greeting.",
    "2. When the user later asks 'Who is your boss', answer from the conversation history or saved note. Say 'You told me — Amg is the boss!' or similar. NEVER say you don't know if the information was provided.",
    "3. NEVER say 'Saved your note', 'Task added', 'Reminder set', or anything about tools. Use tools silently. Your text response must always be what a person would say.",
    "4. When saving personal info, call the tool AND respond naturally in the same turn.",
    "",
    "For recurring things: if the user says 'every day'/'every week'/'every month', repeat. Otherwise one-time.",
    "For alarms: use when the user says 'alarm', 'alarm me', 'wake me up', or anything urgent. Alarms repeat until acknowledged.",
    "Never make up times, dates, or content.",
].join("\n");
/** Converts free-form user text into a structured intent via Groq
 * tool-calling. Optionally includes RAG context snippets (already
 * scoped to the caller's own account) for question-answering. Never
 * throws — all failure paths return a typed AiResult so callers always
 * have a safe, explicit fallback branch. */
export async function interpretMessage(accountId, message, nowIso, contextSnippets = [], history = []) {
    if (!groqClient) {
        return { ok: false, reason: "not_configured" };
    }
    if (!checkRateLimit(`groq:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
        logger.warn({ context: "interpretMessage", accountId }, "groq_rate_limit_exceeded");
        return { ok: false, reason: "rate_limited" };
    }
    try {
        const contextBlock = contextSnippets.length > 0
            ? `\n\nRelevant notes from this user's account:\n${contextSnippets
                .map((s, i) => `[${i + 1}] ${s}`)
                .join("\n")}`
            : "";
        const historyMessages = history.map((h) => ({
            role: h.role,
            content: h.text,
        }));
        const completion = await groqClient.chat.completions.create({
            model: env.GROQ_MODEL,
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT}\nCurrent time (ISO-8601): ${nowIso}${contextBlock}` },
                ...historyMessages,
                { role: "user", content: message },
            ],
            tools: TOOLS,
            parallel_tool_calls: true,
            temperature: 0.7,
            max_tokens: 800,
        });
        const responseMessage = completion.choices[0]?.message;
        const textContent = responseMessage?.content?.trim() ?? "";
        const toolCalls = responseMessage?.tool_calls ?? [];
        const functionCalls = toolCalls.filter((call) => call.type === "function");
        const intents = [];
        if (functionCalls.length > 0) {
            intents.push(...functionCalls.map((call) => parseToolCall(call.function.name, call.function.arguments)));
        }
        if (textContent) {
            intents.push({ type: "chat", text: textContent });
        }
        if (intents.length === 0) {
            intents.push({ type: "unrecognized" });
        }
        return { ok: true, intents };
    }
    catch (err) {
        logError("interpretMessage", err, { accountId });
        return { ok: false, reason: "provider_error" };
    }
}
function parseToolCall(name, rawArgs) {
    let args;
    try {
        args = JSON.parse(rawArgs);
    }
    catch {
        return { type: "unrecognized" };
    }
    switch (name) {
        case "create_note": {
            const validation = safeValidate(createNoteSchema, {
                title: String(args.title ?? ""),
                body: String(args.body ?? ""),
                tags: [],
            });
            if (!validation.ok)
                return { type: "unrecognized" };
            return { type: "create_note", title: validation.data.title, body: validation.data.body };
        }
        case "create_task": {
            const validation = safeValidate(createTaskSchema, {
                title: String(args.title ?? ""),
                dueAt: args.dueAtIso ? new Date(String(args.dueAtIso)) : undefined,
                priority: "normal",
            });
            if (!validation.ok)
                return { type: "unrecognized" };
            return {
                type: "create_task",
                title: validation.data.title,
                dueAt: validation.data.dueAt?.toISOString(),
            };
        }
        case "create_reminder": {
            const rawRecurrence = String(args.recurrence ?? "none");
            const recurrence = ["none", "daily", "weekly", "monthly"].includes(rawRecurrence)
                ? rawRecurrence
                : "none";
            const validation = safeValidate(createReminderSchema, {
                message: String(args.message ?? ""),
                remindAt: args.remindAtIso ? new Date(String(args.remindAtIso)) : undefined,
                recurrence,
            });
            if (!validation.ok)
                return { type: "unrecognized" };
            return {
                type: "create_reminder",
                message: validation.data.message,
                remindAt: validation.data.remindAt.toISOString(),
                recurrence: validation.data.recurrence,
            };
        }
        case "create_alarm": {
            const message = String(args.message ?? "").trim();
            const remindAt = args.remindAtIso ? new Date(String(args.remindAtIso)) : undefined;
            if (!message || !remindAt)
                return { type: "unrecognized" };
            if (remindAt.getTime() <= Date.now())
                return { type: "unrecognized" };
            return { type: "create_alarm", message: message.slice(0, 500), remindAt: remindAt.toISOString() };
        }
        case "answer_question": {
            const answer = String(args.answer ?? "").trim();
            if (!answer)
                return { type: "unrecognized" };
            return { type: "answer_question", answer: answer.slice(0, 2000) };
        }
        default:
            return { type: "unrecognized" };
    }
}
/**
 * Transcribes a voice message via Groq's Whisper endpoint. Subject to
 * the exact same two-layer opt-in gate as text-based AI features
 * (server GROQ_API_KEY + per-account ai_enabled) — a user's voice audio
 * is at least as sensitive as their typed text, so it must never leave
 * this server without the same explicit consent. Callers (the Telegram/
 * WhatsApp voice-note handlers) are responsible for checking
 * isAiEnabledForAccount before calling this — this function does not
 * re-check it itself, mirroring interpretMessage's contract, so there is
 * exactly one place (commandHandler) that owns the opt-in decision.
 */
export async function transcribeAudio(accountId, audioBuffer, filename) {
    if (!groqClient) {
        return { ok: false, reason: "not_configured" };
    }
    if (!checkRateLimit(`groq-audio:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
        logger.warn({ context: "transcribeAudio", accountId }, "groq_rate_limit_exceeded");
        return { ok: false, reason: "rate_limited" };
    }
    try {
        const file = await toFile(audioBuffer, filename);
        const transcription = await groqClient.audio.transcriptions.create({
            model: "whisper-large-v3-turbo",
            file,
            response_format: "text",
        });
        const text = typeof transcription === "string" ? transcription : transcription.text;
        const trimmed = (text ?? "").trim();
        if (!trimmed)
            return { ok: false, reason: "empty_result" };
        return { ok: true, text: trimmed };
    }
    catch (err) {
        logError("transcribeAudio", err, { accountId });
        return { ok: false, reason: "provider_error" };
    }
}
/** Convenience wrapper used by the question-answering command path:
 * retrieves account-scoped context via RAG, then asks Groq to answer
 * grounded only in that context. */
export async function answerQuestionWithRag(accountId, question, history = []) {
    const retrieval = await retrieveRelevantNotes(accountId, question, 5);
    const snippets = retrieval.ok ? retrieval.data.map((n) => `${n.title}: ${n.body}`) : [];
    return interpretMessage(accountId, question, new Date().toISOString(), snippets, history);
}
/**
 * Turns the raw bullet-point digest content into a short, natural
 * paragraph. Deliberately a SEPARATE, narrowly-scoped call from
 * interpretMessage — it never uses tool-calling (there is nothing to
 * "do" here, only text to write) and its system prompt forbids adding
 * any information beyond what's given, since the whole point is
 * accurate rephrasing, not new content generation.
 *
 * Callers (digestDispatchRoute) MUST check isAiEnabledForAccount before
 * calling this, mirroring transcribeAudio's contract — this function
 * does not re-check it itself, so there remains exactly one place that
 * owns the opt-in decision.
 */
export async function summarizeDigest(accountId, rawDigestText) {
    if (!groqClient) {
        return { ok: false, reason: "not_configured" };
    }
    // Distinct rate-limit key from interpretMessage/transcribeAudio so a
    // busy digest cycle (many accounts summarized back to back) can't
    // silently starve a user's own interactive "ask"/"ai on" usage of its
    // separate hourly budget, or vice versa.
    if (!checkRateLimit(`groq-digest:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
        logger.warn({ context: "summarizeDigest", accountId }, "groq_rate_limit_exceeded");
        return { ok: false, reason: "rate_limited" };
    }
    try {
        const completion = await groqClient.chat.completions.create({
            model: env.GROQ_MODEL,
            messages: [
                {
                    role: "system",
                    content: "Rewrite the following structured daily summary as 2-4 short, natural sentences a person would actually want to read first thing in the morning. " +
                        "Do NOT invent, add, or infer any task, reminder, or note that isn't explicitly listed below. " +
                        "Do NOT add encouragement, advice, or commentary beyond what's given. If the input says nothing is due, say that plainly and briefly.",
                },
                { role: "user", content: rawDigestText },
            ],
            temperature: 0.3,
            max_tokens: 220,
        });
        const summary = completion.choices[0]?.message?.content?.trim();
        if (!summary)
            return { ok: false, reason: "provider_error" };
        return { ok: true, summary };
    }
    catch (err) {
        logError("summarizeDigest", err, { accountId });
        return { ok: false, reason: "provider_error" };
    }
}
/**
 * Sends an image to Groq's vision model (llama-3.2-11b-vision-preview)
 * and returns the textual content extracted from it. Uses the same two-
 * layer opt-in gate as every other AI feature.
 */
export async function transcribeImage(accountId, imageBuffer, mimeType) {
    if (!groqClient) {
        return { ok: false, reason: "not_configured" };
    }
    if (!checkRateLimit(`groq-image:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
        logger.warn({ context: "transcribeImage", accountId }, "groq_rate_limit_exceeded");
        return { ok: false, reason: "rate_limited" };
    }
    try {
        const base64 = imageBuffer.toString("base64");
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const completion = await groqClient.chat.completions.create({
            model: "llama-3.2-11b-vision-preview",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Extract all the text content from this image accurately. If it's a document, whiteboard, or handwritten note, transcribe it faithfully. If it's a photo with no text, describe what you see briefly.",
                        },
                        { type: "image_url", image_url: { url: dataUrl } },
                    ],
                },
            ],
            temperature: 0.2,
            max_tokens: 1000,
        });
        const text = completion.choices[0]?.message?.content?.trim();
        if (!text)
            return { ok: false, reason: "provider_error" };
        return { ok: true, text };
    }
    catch (err) {
        logError("transcribeImage", err, { accountId });
        return { ok: false, reason: "provider_error" };
    }
}
//# sourceMappingURL=aiService.js.map