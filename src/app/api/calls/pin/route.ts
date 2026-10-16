import { z } from "zod";
import { apiError, json } from "@/lib/api";
import { activeCall, callPin } from "@/lib/calls";
import { voiceRequest } from "@/lib/calls/http";

/** The caller said or typed a PIN: is it the owner? (Five wrong in a row lock PINs for 15 minutes.) */
export async function POST(req: Request) {
  const r = await voiceRequest(req, z.object({ callId: z.string().min(1).max(64), pin: z.string().regex(/^\d{4,8}$/) }));
  if (!r.ok) return r.res;
  const call = await activeCall(r.db, r.data.callId);
  if (!call) return apiError(404, "No such call in progress");
  return json(await callPin(r.db, call, r.data.pin));
}
