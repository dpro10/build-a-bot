import { z } from "zod";
import { apiError, ipKey, json, limitOr429, parseJson, sameOrigin } from "@/lib/api";
import { getDb } from "@/lib/db";
import { validateApiKey } from "@/lib/agent/brain";
import { demoMode } from "@/lib/env";
import { PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";

/** Check a key before saving it. The key is used once and never stored here. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const parsed = await parseJson(req, z.object({ provider: z.string(), apiKey: z.string().min(8).max(400), baseUrl: z.string().url().optional() }));
  if (!parsed.ok) return parsed.res;
  const limited = await limitOr429(await getDb(), ipKey("brain:validate", req), 20, 600, "Too many key checks — wait a few minutes and try again.");
  if (limited) return limited;
  const provider = parsed.data.provider as ProviderId;
  if (!PROVIDER_BY_ID[provider]) return apiError(422, "Unknown provider");
  const result = await validateApiKey(provider, parsed.data.apiKey, parsed.data.baseUrl);
  if (!result.ok && demoMode && /reach/i.test(result.message ?? "")) {
    return json({ ok: true, unverified: true, message: "Couldn't reach the provider from this demo server — saved without a live check." });
  }
  return json(result);
}
