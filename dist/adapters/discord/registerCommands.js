/**
 * One-off script: registers global slash commands with Discord.
 * Run with: npm run register:discord-commands
 * Global commands can take up to an hour to propagate; use a guild
 * command during development if you need instant updates.
 */
import { env } from "../../config/env.js";
const commands = [
    {
        name: "note",
        description: "Save a note: title | body",
        options: [{ name: "input", description: "title | body", type: 3, required: true }],
    },
    { name: "notes", description: "List your recent notes" },
    {
        name: "task",
        description: "Add a task, optionally: <title> by <when>",
        options: [{ name: "input", description: "title [by <when>]", type: 3, required: true }],
    },
    { name: "tasks", description: "List your open tasks" },
    {
        name: "done",
        description: "Mark a task complete by its id prefix",
        options: [{ name: "input", description: "task id prefix", type: 3, required: true }],
    },
    {
        name: "remind",
        description: "Schedule a reminder: <message> in <10m|2h|1d>",
        options: [{ name: "input", description: "message in <when>", type: 3, required: true }],
    },
    {
        name: "chart",
        description: "Show an activity chart",
        options: [{ name: "input", description: "7d|30d tasks|notes|reminders|all", type: 3, required: false }],
    },
    { name: "link", description: "Get a code to connect another platform to this account" },
    {
        name: "connect",
        description: "Use a code from another platform to merge accounts",
        options: [{ name: "input", description: "the code", type: 3, required: true }],
    },
];
async function main() {
    const res = await fetch(`https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/commands`, {
        method: "PUT",
        headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
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
//# sourceMappingURL=registerCommands.js.map