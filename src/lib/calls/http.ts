/**
 * For /api/calls/*: requests that only the voice server can make (signed with the shared secret,
 * at most five minutes old), with a small body checked against a schema.
 */
import type { z } from "zod";
import { apiError } from "@/lib/api";
import { getDb, type Db } from "@/lib/db";
import { verifyBodySignature } from "./tokens";
import { voiceServer } from "./index";

const MAX_BODY = 512 * 1024;

export async function voiceRequest<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S>; db: Db } | { ok: false; res: Response }> {
  const server = voiceServer();
  if (!server) return { ok: false, res: apiError(404, "Calls aren't set up on this server") };
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return { ok: false, res: apiError(413, "Too large") };
  const body = await req.text();
  if (body.length > MAX_BODY) return { ok: false, res: apiError(413, "Too large") };
  if (!verifyBodySignature(server.secret, body, req.headers.get("x-voice-signature"))) return { ok: false, res: apiError(401, "Bad signature") };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, res: apiError(400, "Invalid JSON body") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, res: apiError(422, "Invalid input") };
  return { ok: true, data: parsed.data, db: await getDb() };
}
