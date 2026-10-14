/** The Discord slash commands (/ask and /link). They work in servers and in DMs. */
export const DISCORD_COMMANDS = [
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

/** Registers (or re-registers: Discord replaces the whole list) the commands for the app. */
export async function registerDiscordCommands(applicationId: string, botToken: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: "PUT",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify(DISCORD_COMMANDS),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}
