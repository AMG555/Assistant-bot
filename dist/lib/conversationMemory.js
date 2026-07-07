import { supabaseAdmin } from "./supabase.js";
import { logError } from "./logger.js";
const MAX_EXCHANGES = 50;
export async function recordExchange(accountId, role, text) {
    const { error } = await supabaseAdmin.from("conversation_history").insert({
        account_id: accountId,
        role,
        text,
    });
    if (error)
        logError("recordExchange", error, { accountId });
}
export async function getConversationHistory(accountId, limit = MAX_EXCHANGES) {
    try {
        const { data, error } = await supabaseAdmin
            .from("conversation_history")
            .select("id, role, text, created_at")
            .eq("account_id", accountId)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error)
            throw error;
        return (data ?? [])
            .reverse()
            .map((r) => ({ id: r.id, role: r.role, text: r.text, createdAt: r.created_at }));
    }
    catch (err) {
        logError("getConversationHistory", err, { accountId });
        return [];
    }
}
export async function countExchanges(accountId) {
    try {
        const { count, error } = await supabaseAdmin
            .from("conversation_history")
            .select("*", { count: "exact", head: true })
            .eq("account_id", accountId);
        if (error)
            throw error;
        return count ?? 0;
    }
    catch (err) {
        logError("countExchanges", err, { accountId });
        return 0;
    }
}
export async function fetchExchangesForSummarization(accountId, count) {
    try {
        const { data, error } = await supabaseAdmin
            .from("conversation_history")
            .select("id, role, text, created_at")
            .eq("account_id", accountId)
            .order("created_at", { ascending: true })
            .limit(count);
        if (error)
            throw error;
        return (data ?? []).map((r) => ({
            id: r.id,
            role: r.role,
            text: r.text,
            createdAt: r.created_at,
        }));
    }
    catch (err) {
        logError("fetchExchangesForSummarization", err, { accountId });
        return [];
    }
}
export async function deleteExchanges(accountId, ids) {
    if (ids.length === 0)
        return;
    try {
        await supabaseAdmin
            .from("conversation_history")
            .delete()
            .eq("account_id", accountId)
            .in("id", ids);
    }
    catch (err) {
        logError("deleteExchanges", err, { accountId });
    }
}
//# sourceMappingURL=conversationMemory.js.map