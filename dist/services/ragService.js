import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { embedText } from "./jinaClient.js";
import { checkRateLimit } from "../middleware/rateLimit.js";
import { env, isSemanticSearchConfigured } from "../config/env.js";
const MAX_SNIPPET_CHARS = 300;
/**
 * Retrieval half of RAG. Tries real semantic search (vector similarity
 * via Jina embeddings) first when configured and the account has notes
 * with embeddings; falls back to Postgres full-text (keyword) search
 * otherwise — including on any embedding-path failure, so a Jina outage
 * degrades search QUALITY, never search AVAILABILITY.
 *
 * Both paths call a Postgres RPC function that bakes the account_id
 * filter into the SQL itself (search_notes_for_account /
 * semantic_search_notes_for_account in schema.sql) — this function has
 * no way to accidentally return another account's notes even if called
 * with a wrong assumption upstream, because the scoping isn't optional
 * application logic, it's inside the query.
 *
 * Bodies are truncated before ever being handed to aiService, so a
 * single giant note can't blow the LLM context budget or unnecessarily
 * expose more of a note than needed to answer one question.
 */
export async function retrieveRelevantNotes(accountId, query, limit = 5) {
    if (isSemanticSearchConfigured && checkRateLimit(`jina-query:${accountId}`, env.GROQ_MAX_CALLS_PER_HOUR, 60 * 60 * 1000)) {
        const semanticResult = await trySemanticSearch(accountId, query, limit);
        if (semanticResult && semanticResult.length > 0) {
            return { ok: true, data: semanticResult };
        }
        // Falls through to full-text search below on any semantic-search
        // failure OR simply zero embedded notes yet for this account —
        // both are legitimate reasons to still try keyword search rather
        // than returning an empty result.
    }
    return fullTextSearch(accountId, query, limit);
}
async function trySemanticSearch(accountId, query, limit) {
    try {
        const embeddingResult = await embedText(query, "retrieval.query");
        if (!embeddingResult.ok || !embeddingResult.embedding)
            return null;
        const literal = `[${embeddingResult.embedding.join(",")}]`;
        const { data, error } = await supabaseAdmin.rpc("semantic_search_notes_for_account", {
            p_account_id: accountId,
            p_query_embedding: literal,
            p_limit: limit,
        });
        if (error)
            throw error;
        return (data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            body: row.body.length > MAX_SNIPPET_CHARS ? `${row.body.slice(0, MAX_SNIPPET_CHARS)}…` : row.body,
            rank: row.similarity,
        }));
    }
    catch (err) {
        logError("retrieveRelevantNotes.trySemanticSearch", err, { accountId });
        return null;
    }
}
async function fullTextSearch(accountId, query, limit) {
    try {
        const { data, error } = await supabaseAdmin.rpc("search_notes_for_account", {
            p_account_id: accountId,
            p_query: query,
            p_limit: limit,
        });
        if (error)
            throw error;
        const notes = (data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            body: row.body.length > MAX_SNIPPET_CHARS ? `${row.body.slice(0, MAX_SNIPPET_CHARS)}…` : row.body,
            rank: row.rank,
        }));
        return { ok: true, data: notes };
    }
    catch (err) {
        logError("retrieveRelevantNotes.fullTextSearch", err, { accountId });
        // Fails closed to "no context" rather than throwing — a retrieval
        // failure should degrade the AI reply's quality, never crash the
        // conversation.
        return { ok: true, data: [] };
    }
}
//# sourceMappingURL=ragService.js.map