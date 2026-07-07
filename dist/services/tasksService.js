import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
export async function createTask(accountId, input) {
    try {
        const { data, error } = await supabaseAdmin
            .from("tasks")
            .insert({
            account_id: accountId,
            title: input.title,
            due_at: input.dueAt ? input.dueAt.toISOString() : null,
            priority: input.priority,
        })
            .select("id")
            .single();
        if (error)
            throw error;
        await supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "task_created" });
        return { ok: true, data: { id: data.id } };
    }
    catch (err) {
        logError("createTask", err, { accountId });
        return { ok: false, error: "Could not save task right now", code: "internal" };
    }
}
export async function completeTask(accountId, taskId) {
    try {
        const { data, error } = await supabaseAdmin
            .from("tasks")
            .update({ completed_at: new Date().toISOString() })
            .eq("id", taskId)
            .eq("account_id", accountId) // enforce ownership even though service role bypasses RLS
            .select("id")
            .maybeSingle();
        if (error)
            throw error;
        if (!data)
            return { ok: false, error: "Task not found", code: "not_found" };
        await supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "task_completed" });
        return { ok: true, data: { id: data.id } };
    }
    catch (err) {
        logError("completeTask", err, { accountId, taskId });
        return { ok: false, error: "Could not update task right now", code: "internal" };
    }
}
/** Deletes a task outright — used only by the undo mechanism to revert
 * a `task ...` creation. Scoped by account_id. */
export async function deleteTask(accountId, taskId) {
    try {
        const { error } = await supabaseAdmin.from("tasks").delete().eq("id", taskId).eq("account_id", accountId);
        if (error)
            throw error;
        return { ok: true, data: null };
    }
    catch (err) {
        logError("deleteTask", err, { accountId, taskId });
        return { ok: false, error: "Could not undo that right now", code: "internal" };
    }
}
/** Reverts a `done <id>` completion — used only by the undo mechanism.
 * Scoped by account_id. */
export async function uncompleteTask(accountId, taskId) {
    try {
        const { error } = await supabaseAdmin
            .from("tasks")
            .update({ completed_at: null })
            .eq("id", taskId)
            .eq("account_id", accountId);
        if (error)
            throw error;
        return { ok: true, data: null };
    }
    catch (err) {
        logError("uncompleteTask", err, { accountId, taskId });
        return { ok: false, error: "Could not undo that right now", code: "internal" };
    }
}
export async function listOpenTasks(accountId, limit = 15) {
    try {
        const { data, error } = await supabaseAdmin
            .from("tasks")
            .select("id, title, due_at, priority")
            .eq("account_id", accountId)
            .is("completed_at", null)
            .order("due_at", { ascending: true, nullsFirst: false })
            .limit(limit);
        if (error)
            throw error;
        return {
            ok: true,
            data: (data ?? []).map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at, priority: t.priority })),
        };
    }
    catch (err) {
        logError("listOpenTasks", err, { accountId });
        return { ok: false, error: "Could not load tasks right now", code: "internal" };
    }
}
//# sourceMappingURL=tasksService.js.map