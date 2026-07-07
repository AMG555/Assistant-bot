import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { env } from "../config/env.js";
/**
 * This client is constructed ONCE, server-side, using the service role
 * key. It must never be imported by, or its key exposed to, any code
 * path that renders to or is fetched by an end-user client. There is no
 * frontend in this project that talks to Supabase directly — every
 * mutation flows through our own validated routes/services first.
 *
 * We explicitly disable Realtime (we only use Postgres queries and
 * Storage, never subscriptions) and inject the `ws` package as the
 * WebSocket transport per Supabase's own guidance for Node < 22 — this
 * avoids a runtime crash on Render's Node 20 LTS image without pulling
 * in a real-time channel we don't need.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
    realtime: {
        transport: WebSocket,
    },
});
//# sourceMappingURL=supabase.js.map