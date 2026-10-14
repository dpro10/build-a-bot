import { getDb } from "@/lib/db";
import { apiError, authed, ipKey, json, limitOr429, parseJson, sameOrigin } from "@/lib/api";
import { getOrCreateUser } from "@/lib/auth/session";
import { createBot, createBotSchema } from "@/lib/bots/create";
import { listBots } from "@/lib/data";

export async function GET() {
  const a = await authed();
  if (!a.ok) return a.res;
  const bots = await listBots(a.db, a.user.id);
  return json({ bots });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const parsed = await parseJson(req, createBotSchema);
  if (!parsed.ok) return parsed.res;
  const db = await getDb();
  const limited = await limitOr429(db, ipKey("bots:create", req), 20, 3600, "That's a lot of new bots from here — try again in a bit.");
  if (limited) return limited;
  const user = await getOrCreateUser({ timezone: parsed.data.timezone });
  const result = await createBot(db, user, parsed.data);
  if (!result.ok) return apiError(result.status ?? 400, result.error);
  return json({ id: result.bot.id, notes: result.notes, upgrade: result.upgrade ?? null });
}
