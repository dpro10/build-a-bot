import { schema } from "@/lib/db";
import { apiError, authed, json, sameOrigin } from "@/lib/api";
import { pairingCode } from "@/lib/crypto";
import { appUrl } from "@/lib/env";

const TTL_SECONDS = 15 * 60;

/** The app asks for a code; the owner types it into the desktop app on their computer. */
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
  return json({ code, expiresInSeconds: TTL_SECONDS, expiresAt: expiresAt.toISOString(), server: appUrl() });
}
