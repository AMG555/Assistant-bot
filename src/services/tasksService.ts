import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
import { fireEvent } from "../lib/eventBus.js";
import type { CreateTaskInput } from "../validation/schemas.js";
import type { ServiceResult } from "./accountService.js";

export async function createTask(
  accountId: string,
  input: CreateTaskInput
): Promise<ServiceResult<{ id: string }>> {
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
    if (error) throw error;

    await supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "task_created" });
    void fireEvent(accountId, "task_created", { title: input.title, dueAt: input.dueAt?.toISOString() });

    return { ok: true, data: { id: data.id } };
  } catch (err) {
    logError("createTask", err, { accountId });
    return { ok: false, error: "Could not save task right now", code: "internal" };
  }
}

export async function completeTask(accountId: string, taskId: string): Promise<ServiceResult<{ id: string }>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("account_id", accountId)
      .select("id, title")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Task not found", code: "not_found" };

    await supabaseAdmin.from("activity_log").insert({ account_id: accountId, kind: "task_completed" });
    void fireEvent(accountId, "task_completed", { taskId: data.id, title: data.title });

    return { ok: true, data: { id: data.id } };
  } catch (err) {
    logError("completeTask", err, { accountId, taskId });
    return { ok: false, error: "Could not update task right now", code: "internal" };
  }
}

/** Deletes a task outright — used only by the undo mechanism to revert
 * a `task ...` creation. Scoped by account_id. */
export async function deleteTask(accountId: string, taskId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin.from("tasks").delete().eq("id", taskId).eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("deleteTask", err, { accountId, taskId });
    return { ok: false, error: "Could not undo that right now", code: "internal" };
  }
}

/** Reverts a `done <id>` completion — used only by the undo mechanism.
 * Scoped by account_id. */
export async function uncompleteTask(accountId: string, taskId: string): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabaseAdmin
      .from("tasks")
      .update({ completed_at: null })
      .eq("id", taskId)
      .eq("account_id", accountId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (err) {
    logError("uncompleteTask", err, { accountId, taskId });
    return { ok: false, error: "Could not undo that right now", code: "internal" };
  }
}

export async function listOpenTasks(
  accountId: string,
  limit = 15
): Promise<ServiceResult<Array<{ id: string; title: string; dueAt: string | null; priority: string }>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id, title, due_at, priority")
      .eq("account_id", accountId)
      .is("completed_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at, priority: t.priority })),
    };
  } catch (err) {
    logError("listOpenTasks", err, { accountId });
    return { ok: false, error: "Could not load tasks right now", code: "internal" };
  }
}
