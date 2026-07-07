/**
 * One-off script: registers our /telegram/webhook URL with Telegram,
 * along with the shared secret token used by verifyTelegramWebhook.
 * Run with: npm run set:telegram-webhook
 */
import { env } from "../../config/env.js";
async function main() {
    const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/telegram/webhook`;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, secret_token: env.TELEGRAM_WEBHOOK_SECRET }),
    });
    const body = await res.json();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ status: res.status, body }, null, 2));
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=setWebhook.js.map