import { schema } from "@/lib/db";
import { apiError, authed, json, sameOrigin } from "@/lib/api";
import { pairingCode } from "@/lib/crypto";
import { appUrl } from "@/lib/env";

const TTL_SECONDS = 15 * 60;
/** Where bridge/bab-bridge.mjs connects when `pair` gets no --server flag (and BAB_SERVER is unset). */
const BRIDGE_DEFAULT_SERVER = "https://build-a-bot.site";

/** The app asks for a code; the owner types it into the Bridge on their computer. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
  await a.db.insert(schema.pairingCodes).values({
    code,
    purpose: "bridge",
    ownerId: a.user.id,
    expiresAt,
  });
  const server = appUrl();
  // Any other deployment (a preview, local dev) must tell the CLI where to pair.
  const serverFlag = server === BRIDGE_DEFAULT_SERVER ? "" : ` --server ${server}`;
  // A local server is run from this repo, where the Bridge is a file, not an npm package.
  const cli = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(server) ? "node bridge/bab-bridge.mjs" : "npx build-a-bot-bridge";
  return json({
    code,
    expiresInSeconds: TTL_SECONDS,
    expiresAt: expiresAt.toISOString(),
    server,
    cli,
    command: `${cli} pair ${code}${serverFlag}`,
  });
}
