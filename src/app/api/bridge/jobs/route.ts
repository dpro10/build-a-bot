import { apiError, json } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";
import { claimJob, mcpTokenFor } from "@/lib/bridge/jobs";
import { sleep } from "@/lib/utils";

export const maxDuration = 60;

/** Long-poll for the next turn to run on this computer (up to ~25s). */
export async function GET(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "Unknown or revoked device");
  const waitSeconds = Math.min(25, Math.max(0, Number(new URL(req.url).searchParams.get("wait") ?? 25)));
  const deadline = Date.now() + waitSeconds * 1000;
  do {
    const job = await claimJob(auth.db, auth.device.ownerId, auth.device.id);
    if (job) {
      return json({ job: { id: job.id, botId: job.botId, input: job.input, mcpToken: mcpTokenFor(job) } });
    }
    if (req.signal.aborted) break;
    await sleep(1000);
  } while (Date.now() < deadline);
  return new Response(null, { status: 204 });
}
