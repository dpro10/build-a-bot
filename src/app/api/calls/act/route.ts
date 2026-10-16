import { z } from "zod";
import { apiError, json } from "@/lib/api";
import { activeCall, callAct } from "@/lib/calls";
import { voiceRequest } from "@/lib/calls/http";

// The bot's agent may search, browse or wait for the owner's computer.
export const maxDuration = 300;

/** A request from a call, done by the bot's own agent (apps, memory, approvals, receipts). */
export async function POST(req: Request) {
  const r = await voiceRequest(req, z.object({ callId: z.string().min(1).max(64), request: z.string().trim().min(1).max(4000) }));
  if (!r.ok) return r.res;
  const call = await activeCall(r.db, r.data.callId);
  if (!call) return apiError(404, "No such call in progress");
  return json(await callAct(r.db, call, r.data.request));
}
