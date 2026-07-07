import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { supabaseAdmin } from "../lib/supabase.js";
import { logError } from "../lib/logger.js";
const WIDTH = 640;
const HEIGHT = 400;
const canvasRenderer = new ChartJSNodeCanvas({ width: WIDTH, height: HEIGHT, backgroundColour: "#ffffff" });
function dayKey(d) {
    return d.toISOString().slice(0, 10);
}
function buildDayBuckets(days) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        out.push(dayKey(d));
    }
    return out;
}
/** Renders a PNG buffer summarizing the user's activity over a window.
 * Returns a ServiceResult so callers never have to guess whether a
 * Buffer of length 0 means "empty chart" vs "failure". */
export async function renderActivityChart(accountId, range, kind) {
    try {
        const days = range === "7d" ? 7 : 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        let query = supabaseAdmin
            .from("activity_log")
            .select("kind, occurred_at")
            .eq("account_id", accountId)
            .gte("occurred_at", since);
        if (kind !== "all") {
            const kindMap = {
                tasks: ["task_created", "task_completed"],
                notes: ["note_created"],
                reminders: ["reminder_created", "reminder_sent"],
            };
            query = query.in("kind", kindMap[kind] ?? []);
        }
        const { data, error } = await query;
        if (error)
            throw error;
        const buckets = buildDayBuckets(days);
        const counts = new Map(buckets.map((b) => [b, 0]));
        for (const row of data ?? []) {
            const key = dayKey(new Date(row.occurred_at));
            if (counts.has(key))
                counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const buffer = await canvasRenderer.renderToBuffer({
            type: "bar",
            data: {
                labels: buckets.map((b) => b.slice(5)), // MM-DD
                datasets: [
                    {
                        label: `Activity (${kind}) — last ${days} days`,
                        data: buckets.map((b) => counts.get(b) ?? 0),
                        backgroundColor: "#2563eb",
                        borderRadius: 4,
                    },
                ],
            },
            options: {
                responsive: false,
                plugins: {
                    legend: { display: true, position: "top" },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                },
            },
        });
        return { ok: true, data: buffer };
    }
    catch (err) {
        logError("renderActivityChart", err, { accountId, range, kind });
        return { ok: false, error: "Could not generate chart right now", code: "internal" };
    }
}
//# sourceMappingURL=chartService.js.map