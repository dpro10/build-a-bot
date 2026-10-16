import { z } from "zod";
import { apiError, json } from "@/lib/api";
import { activeCall, endCall } from "@/lib/calls";
import { voiceRequest } from "@/lib/calls/http";

const Report = z.object({
  endedBy: z.string().max(20),
  durationS: z.number().min(0),
  turns: z.array(z.unknown()).max(1000),
  latency: z.object({ turns: z.number().optional(), p50Ms: z.number().nullable().optional(), p90Ms: z.number().nullable().optional() }).partial().optional(),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), model: z.string().max(120).optional() }).optional(),
  engine: z.object({ version: z.string().max(60).optional() }).optional(),
});

/** The call is over: its transcript and report, and what it cost. */
export async function POST(req: Request) {
  const r = await voiceRequest(req, z.object({ callId: z.string().min(1).max(64), report: Report }));
  if (!r.ok) return r.res;
  const call = await activeCall(r.db, r.data.callId);
  if (!call) return apiError(404, "No such call in progress");
  return json(await endCall(r.db, call, r.data.report));
}
