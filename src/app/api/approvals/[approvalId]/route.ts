import { z } from "zod";
import { apiError, authed, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { decideApproval } from "@/lib/agent/approvals";

// Approving a web form fill can run a cloud browser for up to ~150 s.
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteCtx<{ approvalId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { approvalId } = await ctx.params;
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ decision: z.enum(["approve", "deny"]) }));
  if (!parsed.ok) return parsed.res;
  const result = await decideApproval(a.db, { approvalId, ownerId: a.user.id, decision: parsed.data.decision, via: "web" });
  if (!result.ok) return apiError(409, result.error, { approval: result.approval ?? null });
  return json({ approval: result.approval, followUp: result.followUp ?? null });
}
