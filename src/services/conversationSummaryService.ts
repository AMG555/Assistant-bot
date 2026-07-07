import { env, isGroqConfigured } from "../config/env.js";
import { groqClient } from "./groqClient.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { logError } from "../lib/logger.js";
import { createNote } from "./notesService.js";
import { fetchExchangesForSummarization, deleteExchanges } from "../lib/conversationMemory.js";

export type SummaryResult =
  | { ok: true; summary: string }
  | { ok: false; reason: "not_configured" | "rate_limited" | "provider_error" };

/**
 * Takes raw conversation exchanges and asks Groq to produce a concise
 * 2-3 sentence summary capturing the key topics and facts discussed.
 * This summary is then saved as a note so old conversations survive in
 * the RAG index and are searchable via `ask` or natural-language queries.
 *
 * Callers MUST check isAiEnabledForAccount before calling — this function
 * does not re-check it itself, consistent with the rest of the AI layer.
 */
export async function summarizeConversation(
  accountId: string,
  exchanges: { role: "user" | "assistant"; text: string }[]
): Promise<SummaryResult> {
  if (!groqClient) return { ok: false, reason: "not_configured" };

  if (!checkRateLimit(`groq-summary:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
    logError("summarizeConversation", "rate_limited", { accountId });
    return { ok: false, reason: "rate_limited" };
  }

  try {
    const conversationText = exchanges.map((e) => `${e.role}: ${e.text}`).join("\n");

    const completion = await groqClient.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Summarize the following conversation in 2-4 concise sentences. " +
            "Capture key information, decisions, facts, and preferences the user mentioned. " +
            "Do NOT add any commentary, advice, or information not present in the conversation.",
        },
        { role: "user", content: conversationText },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const summary = completion.choices[0]?.message?.content?.trim();
    if (!summary) return { ok: false, reason: "provider_error" };

    return { ok: true, summary };
  } catch (err) {
    logError("summarizeConversation", err, { accountId });
    return { ok: false, reason: "provider_error" };
  }
}

/**
 * High-level orchestrator: called after a new exchange has been recorded.
 * Checks whether the conversation has grown past the summarization
 * threshold. If so, fetches the oldest exchanges, summarizes them,
 * saves the summary as a note, and deletes the raw exchanges.
 */
const SUMMARIZATION_THRESHOLD = 20;
const SUMMARIZATION_BATCH = 10;

export async function maybeSummarizeOldConversation(
  accountId: string,
  totalExchanges: number
): Promise<void> {
  if (!isGroqConfigured) return;
  if (!checkRateLimit(`groq-summary:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) return;

  // Only summarize when we cross the threshold (not every single time)
  if (totalExchanges < SUMMARIZATION_THRESHOLD) return;
  if (totalExchanges % SUMMARIZATION_THRESHOLD !== 1) return;

  const oldExchanges = await fetchExchangesForSummarization(accountId, SUMMARIZATION_BATCH);
  if (oldExchanges.length < 3) return;

  const summaryResult = await summarizeConversation(accountId, oldExchanges);
  if (!summaryResult.ok) return;

  const oldest = oldExchanges[0]!;
  const newest = oldExchanges[oldExchanges.length - 1]!;
  const dateLabel = `${new Date(oldest.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(newest.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  try {
    await createNote(accountId, {
      title: `Conversation summary — ${dateLabel}`,
      body: summaryResult.summary,
      tags: ["ai-summary"],
    });
  } catch {
    return;
  }

  await deleteExchanges(accountId, oldExchanges.map((e) => e.id));
}
