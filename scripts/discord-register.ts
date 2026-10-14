/**
 * Register the Discord slash commands (/ask and /link) for the app.
 *   DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… npx tsx scripts/discord-register.ts
 * The server also does this by itself every few hours once those keys are set (see
 * src/lib/channels/self-setup.ts). Then set the app's Interactions Endpoint URL to
 * {APP_URL}/api/webhooks/discord in the Discord developer portal.
 */
import { DISCORD_COMMANDS, registerDiscordCommands } from "../src/lib/channels/discord-commands";

async function main() {
  const appId = process.env.DISCORD_APPLICATION_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) {
    console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN.");
    process.exit(1);
  }
  const res = await registerDiscordCommands(appId, token);
  if (!res.ok) {
    console.error(`Discord answered ${res.status}: ${res.body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`Registered ${DISCORD_COMMANDS.length} commands: ${DISCORD_COMMANDS.map((c) => `/${c.name}`).join(", ")}`);
}

void main();
