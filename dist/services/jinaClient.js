import { env } from "../config/env.js";
import { logError } from "../lib/logger.js";
const JINA_API_BASE = "https://api.jina.ai/v1";
/**
 * Requests a single normalized embedding vector from Jina's API.
 * Deliberately request `normalized: true` so cosine similarity (used by
 * semantic_search_notes_for_account's `<=>` operator) behaves correctly
 * — un-normalized vectors would make cosine distance meaningless.
 *
 * `task` matters for retrieval quality: Jina's models use different
 * internal adapters depending on whether text is being indexed
 * (`retrieval.passage`) or used as a search query (`retrieval.query`) —
 * using the wrong one doesn't error, it just silently produces worse
 * search results, which is why every call site in this codebase is
 * explicit about which one it means.
 */
export async function embedText(text, task) {
    if (!env.JINA_API_KEY) {
        return { ok: false, error: "not_configured" };
    }
    try {
        const res = await fetch(`${JINA_API_BASE}/embeddings`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.JINA_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: env.JINA_EMBEDDING_MODEL,
                task,
                dimensions: env.JINA_EMBEDDING_DIMENSIONS,
                normalized: true,
                input: [text],
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Jina embeddings API error ${res.status}: ${body.slice(0, 200)}`);
        }
        const body = (await res.json());
        const embedding = body.data?.[0]?.embedding;
        if (!embedding || embedding.length !== env.JINA_EMBEDDING_DIMENSIONS) {
            throw new Error(`Jina returned an unexpected embedding shape (expected ${env.JINA_EMBEDDING_DIMENSIONS} dimensions)`);
        }
        return { ok: true, embedding };
    }
    catch (err) {
        logError("jinaClient.embedText", err, { task });
        return { ok: false, error: "embedding_failed" };
    }
}
/** Formats a raw embedding vector as the string literal Postgres/
 * pgvector expects for a `vector` column, e.g. "[0.1,0.2,0.3]". */
export function embeddingToPgVectorLiteral(embedding) {
    return `[${embedding.join(",")}]`;
}
//# sourceMappingURL=jinaClient.js.map