import { embedText, embeddingToPgVectorLiteral } from "./jinaClient.js";
import { setNoteEmbedding, getNoteById } from "./notesService.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { env, isSemanticSearchConfigured } from "../config/env.js";
import { logError, logger } from "../lib/logger.js";
/**
 * Computes and stores an embedding for a note, as a best-effort side
 * effect of note creation/editing — same contract as
 * notionSyncService.pushNoteToNotion: this must NEVER block or fail the
 * primary action (saving the note itself). If Jina isn't configured,
 * or the account has exhausted its embedding rate budget, or the API
 * call fails, the note simply doesn't get a vector yet and continues to
 * be found via the always-available full-text search — never a hard
 * failure surfaced to the user.
 */
export async function embedNoteInBackground(accountId, noteId) {
    if (!isSemanticSearchConfigured)
        return;
    // Rate limit is per-account, distinct from Groq's own budget — an
    // account heavy on AI note-taking must not be able to silently starve
    // itself (or, since Jina's free tier is a single shared key, other
    // accounts) of embedding calls without an explicit ceiling.
    if (!checkRateLimit(`jina-embed:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
        logger.warn({ context: "embedNoteInBackground", accountId }, "embedding_rate_limited");
        return;
    }
    try {
        const noteResult = await getNoteById(accountId, noteId);
        if (!noteResult.ok || !noteResult.data)
            return;
        const note = noteResult.data;
        const textToEmbed = `${note.title}\n\n${note.body}`.trim();
        if (!textToEmbed)
            return;
        const embeddingResult = await embedText(textToEmbed, "retrieval.passage");
        if (!embeddingResult.ok || !embeddingResult.embedding) {
            logger.warn({ context: "embedNoteInBackground", accountId, noteId }, "embedding_generation_failed");
            return;
        }
        await setNoteEmbedding(accountId, noteId, embeddingToPgVectorLiteral(embeddingResult.embedding));
    }
    catch (err) {
        logError("embedNoteInBackground", err, { accountId, noteId });
    }
}
//# sourceMappingURL=embeddingSyncService.js.map