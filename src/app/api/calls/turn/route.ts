import { z } from "zod";
import { json } from "@/lib/api";
import { recordCallTurn } from "@/lib/calls";
import { voiceRequest } from "@/lib/calls/http";

/** One line of a call's live transcript. */
export async function POST(req: Request) {
  const r = await voiceRequest(req, z.object({ callId: z.string().min(1).max(64), turn: z.unknown() }));
  if (!r.ok) return r.res;
  return json({ ok: await recordCallTurn(r.db, r.data.callId, r.data.turn) });
}
