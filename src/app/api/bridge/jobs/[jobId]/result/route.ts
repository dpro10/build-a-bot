import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json, parseJson, type RouteCtx } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";
import { completeJob } from "@/lib/bridge/jobs";

export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteCtx<{ jobId: string }>) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "Unknown or revoked device");
  const { jobId } = await ctx.params;
  const parsed = await parseJson(
    req,
    z.object({
      ok: z.boolean(),
      text: z.string().max(20000).optional(),
      error: z.string().max(2000).optional(),
      costUsd: z.number().min(0).max(1000).optional(),
      model: z.string().max(120).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const [job] = await auth.db
    .select()
    .from(schema.bridgeJobs)
    .where(and(eq(schema.bridgeJobs.id, jobId), eq(schema.bridgeJobs.deviceId, auth.device.id)))
    .limit(1);
  if (!job) return apiError(404, "Job not found");
  if (job.status !== "running") return apiError(409, `Job is ${job.status}`);
  await completeJob(auth.db, job, parsed.data);
  return json({ ok: true });
}
