import { z } from "zod";
import { apiError, json } from "@/lib/api";
import { callSession, claimCall } from "@/lib/calls";
import { voiceRequest } from "@/lib/calls/http";

/** The voice server takes a call: who's on the line, the bot's persona, its first words. Once per call. */
export async function POST(req: Request) {
  const r = await voiceRequest(req, z.object({ callId: z.string().min(1).max(64), kind: z.enum(["web", "phone"]) }));
  if (!r.ok) return r.res;
  const call = await claimCall(r.db, r.data.callId, r.data.kind);
  if (!call) return apiError(409, "This call has already started, ended or expired");
  const info = await callSession(r.db, call);
  if (!info) return apiError(404, "This bot is gone");
  return json(info);
}
