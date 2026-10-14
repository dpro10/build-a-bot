/**
 * Register the Discord slash commands (/ask and /link) for the app.
 *   DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… npx tsx scripts/discord-register.ts
 * Then set the app's Interactions Endpoint URL to {APP_URL}/api/webhooks/discord
 * in the Discord developer portal. Commands work in DMs and in servers.
 */
const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;

const commands = [
  {
    name: "ask",
    description: "Ask your bot anything",
    type: 1,
    integration_types: [0, 1], // server install and user install
    contexts: [0, 1, 2], // servers, bot DMs, other DMs
    options: [{ name: "prompt", description: "What should it do?", type: 3, required: true, max_length: 2000 }],
  },
  {
    name: "link",
    description: "Link your bot with the code from its Channels page",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [{ name: "code", description: "The code shown in the app", type: 3, required: true, max_length: 20 }],
  },
];

async function main() {
  if (!appId || !token) {
    console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN.");
    process.exit(1);
  }
  const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: "PUT",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Discord answered ${res.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`Registered ${commands.length} commands: ${commands.map((c) => `/${c.name}`).join(", ")}`);
}

void main();
