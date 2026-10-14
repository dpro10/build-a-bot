import { schema } from "@/lib/db";
import { apiError, authed, json, sameOrigin } from "@/lib/api";
import { pairingCode } from "@/lib/crypto";

/** The app asks for a code; the owner types it into the Bridge on their computer. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const code = pairingCode();
  await a.db.insert(schema.pairingCodes).values({
    code,
    purpose: "bridge",
    ownerId: a.user.id,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  return json({ code, expiresInSeconds: 900, command: `npx build-a-bot-bridge pair ${code}` });
}
