import { z } from "zod";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { pinLocked, pinProblem, setPhonePin } from "@/lib/calls/pin";

/** Is a phone PIN set (never the PIN itself)? */
export async function GET() {
  const a = await authed();
  if (!a.ok) return a.res;
  return json({ set: Boolean(a.user.phonePinHash), locked: pinLocked(a.user) });
}

/** Set or change the PIN that proves it's you when you call your bot. */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ pin: z.string().max(16) }));
  if (!parsed.ok) return parsed.res;
  const problem = pinProblem(parsed.data.pin);
  if (problem) return apiError(422, problem, { code: "weak_pin" });
  await setPhonePin(a.db, a.user.id, parsed.data.pin);
  return json({ set: true });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  await setPhonePin(a.db, a.user.id, null);
  return json({ set: false });
}
