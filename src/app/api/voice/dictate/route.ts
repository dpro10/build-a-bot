import { z } from "zod";
import { apiError, json, limitOr429, readBodyCapped } from "@/lib/api";
import { APP_CATEGORIES, MAX_DICTATION_BYTES, MAX_DICTATION_MS, dictate } from "@/lib/dictation";
import { voiceAuth } from "@/lib/dictation/auth";
import { demoMode } from "@/lib/env";
import { audioExtension } from "@/lib/transcribe";

export const maxDuration = 60;

const flag = z.enum(["0", "1"]).optional();
const query = z.object({
  durationMs: z.coerce.number().int().min(1).max(MAX_DICTATION_MS),
  speechMs: z.coerce.number().int().min(0).optional(),
  category: z.enum(APP_CATEGORIES).optional(),
  app: z.string().trim().max(60).optional(),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  polish: flag,
  commands: flag,
  styles: flag,
  demo: z.string().max(10).optional(),
});

/**
 * One dictation: the raw recording (webm/ogg/mp4/wav) in the body → what to type, or a request
 * for the bot ("Hey Otto, …"). Query: durationMs, speechMs, category, app, lang, polish, commands,
 * styles. The audio is never kept, and what was said isn't stored.
 */
export async function POST(req: Request) {
  const a = await voiceAuth(req, { write: true });
  if (!a.ok) return a.res;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return apiError(422, "Bad dictation parameters");
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!audioExtension(mime)) return apiError(415, "Send audio as webm, ogg, wav, mp3 or m4a.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DICTATION_BYTES) return apiError(413, "That recording is too large.");
  // People pause between dictations; this only stops runaway scripts.
  const limited = await limitOr429(a.db, `dictate:${a.owner.id}`, 60, 60, "That's a lot of voice typing at once. Give it a moment.");
  if (limited) return limited;
  const audio = await readBodyCapped(req, MAX_DICTATION_BYTES);
  if (!audio) return apiError(413, "That recording is too large.");

  const d = q.data;
  const sample = demoMode && d.demo ? (d.demo === "command" ? "command" : Number.isInteger(Number(d.demo)) ? Number(d.demo) : undefined) : undefined;
  const out = await dictate(a.db, a.owner, {
    audio,
    mime,
    durationMs: d.durationMs,
    speechMs: d.speechMs,
    category: d.category,
    appName: d.app,
    language: d.lang,
    polish: d.polish !== "0",
    commands: d.commands !== "0",
    styles: d.styles !== "0",
    demoSample: sample,
  });
  if (!out.ok) return apiError(out.status, out.error, { code: out.code, upgrade: out.upgrade });
  return json({ ...out.result, usage: out.usage, simulated: out.simulated, ms: out.ms });
}
