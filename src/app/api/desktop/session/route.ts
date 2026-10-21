import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";
import { getCredit } from "@/lib/billing/credit";
import { appUrl, available, config, demoMode, demoSpeech } from "@/lib/env";
import { CHUNK_MS, MEETINGS_CONNECTOR } from "@/lib/meetings";
import { dictationUsage, speechToTextAvailable, voiceEditAvailable, voicePolishAvailable } from "@/lib/dictation";
import { transcriptionAvailable, transcriptionSetup } from "@/lib/transcribe";

/** The desktop app's view of the account: which bots can take notes, whether there's credit, and voice typing. */
export async function GET(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "This computer was unpaired. Pair it again from the app.");
  const { db, device } = auth;
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, device.ownerId)).limit(1);
  if (!owner) return apiError(401, "Account not found");
  const bots = await db.select().from(schema.bots).where(eq(schema.bots.ownerId, owner.id));
  const on = bots.length
    ? await db
        .select({ botId: schema.connections.botId, status: schema.connections.status })
        .from(schema.connections)
        .where(and(inArray(schema.connections.botId, bots.map((b) => b.id)), eq(schema.connections.connectorId, MEETINGS_CONNECTOR)))
    : [];
  const credit = await getCredit(db, owner.id);
  const hasCredit = credit.balanceMicros > 0;
  // Notes written by an included model cost credit (when it's the real one); the owner's own AI is free here.
  const needsCredit = (b: (typeof bots)[number]) => b.brain.kind === "included" && Boolean(config.tokenFactory.apiKey);
  const meetingsOn = (b: (typeof bots)[number]) => on.some((c) => c.botId === b.id && c.status !== "disabled");
  return json({
    device: { id: device.id, name: device.name },
    // No plans: people pay for what they use ("payg" is what older apps read as the plan).
    owner: { name: owner.name ?? owner.email?.split("@")[0] ?? null, plan: "payg" },
    /** Credit left, in micro-dollars (what an included model, lookups and the like are paid from). */
    credit: { balanceMicros: credit.balanceMicros },
    bots: bots.map((b) => ({
      id: b.id,
      name: b.name,
      avatar: b.avatar,
      color: b.color,
      paused: b.status === "paused",
      meetingsOn: meetingsOn(b),
      /** Its notes are written by an included model, so taking them needs credit (its owner's own AI is free here). */
      notesNeedCredit: needsCredit(b),
      // No `subscription` since the Bridge went (2026-10-20): older apps read a missing one as "no bot thinks here".
    })),
    meetings: {
      /**
       * This server turns a meeting's audio into text itself, for an app that can't hear it on the
       * computer. Without it, notes are taken only with what the app heard (and nothing is made up).
       */
      available: transcriptionAvailable(),
      /** Meeting notes are taken here, from what the app heard on the computer (NVIDIA Parakeet): only the lines are sent. */
      local: true,
      /** Credit to take notes on an included model. */
      credit: hasCredit,
      /**
       * For older apps, which read this as meeting minutes left: plenty, or none when there's no credit
       * and every bot taking notes would need it.
       */
      minutesLeft: hasCredit || !bots.some((b) => meetingsOn(b) && needsCredit(b)) ? 600 : 0,
      chunkMs: CHUNK_MS,
    },
    voice: {
      /**
       * This server turns recordings into text. When it doesn't, voice typing works only with what
       * the computer hears itself (Private speech), and the app never sends a recording.
       */
      available: speechToTextAvailable(),
      /** The AI cleanup (fillers out, punctuation, corrections); without it, the plain cleanup. */
      polish: voicePolishAvailable(),
      /** Editing by voice (Shift with the shortcut): a model for it, or demo mode. */
      edit: voiceEditAvailable(),
      /** Tests only (DEMO_SPEECH): no speech-to-text key, and recordings "hear" sample lines. */
      simulated: demoSpeech && !transcriptionSetup(),
      /** Takes what the computer already heard (on-device speech-to-text): no audio is sent. */
      local: true,
      usage: await dictationUsage(db, owner),
    },
    /** "Give my bot a folder": this server keeps files (its Library is set up). */
    library: { available: available("library") },
    appUrl: appUrl(),
    demo: demoMode,
  });
}

/** "Unpair" in the desktop app: the device revokes its own token, so it stops working everywhere. */
export async function DELETE(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "Already unpaired.");
  await auth.db
    .update(schema.bridgeDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.bridgeDevices.id, auth.device.id), isNull(schema.bridgeDevices.revokedAt)));
  return json({ ok: true });
}
