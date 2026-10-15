/**
 * Voice typing: hold a key anywhere, talk, let go, and what you meant is typed where your cursor
 * is (the desktop app pastes it). Also on the Voice typing page, in the browser.
 *
 * One dictation, in order:
 *  1. Plan limits (words a month) and the site's daily ceiling.
 *  2. Speech-to-text, steered toward the owner's words (their dictionary, their bots' names, the
 *     names their bots remember).
 *  3. "Hey Otto, …" at the start is a request for the bot: it goes back as a command (the caller
 *     runs it with /api/voice/ask), and isn't typed.
 *  4. Otherwise the cleanup: the plain one (tidyTranscript), then the AI one (polish.ts) when it's
 *     on and checks out, then the owner's spellings and snippets.
 *  5. The words typed count toward the plan.
 *
 * The audio is transcribed in memory and thrown away; what was said is never stored or logged.
 * Only the number of words is kept (the plan's meter).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { DictionaryEntry, User } from "@/lib/db/schema";
import { underDailyCeiling } from "@/lib/billing/ceiling";
import { checkLimit, getUsage, recordUsage } from "@/lib/billing/usage";
import { getPlan } from "@/lib/billing/plans";
import { demoMode } from "@/lib/env";
import { rateLimit } from "@/lib/safety/ratelimit";
import { TranscriptionError, transcribe, transcriptionSetup } from "@/lib/transcribe";
import { demoEdit, demoHeard, demoPolish, type DemoSample } from "./demo";
import { editText, needsSelection } from "./edit";
import { polishSetup, polishText, type AppCategory } from "./polish";
import {
  applyDictionary,
  countWords,
  isPhantom,
  isPromptEcho,
  matchCommand,
  needsPolish,
  properNouns,
  protectSnippets,
  restoreSnippets,
  tidyTranscript,
  uniqueWords,
  whisperPrompt,
} from "./text";

export { APP_CATEGORIES, isAppCategory, type AppCategory } from "./polish";

/** Long enough for a long email, short enough that one upload stays small (~2 MB of opus). */
export const MAX_DICTATION_MS = 10 * 60_000;
export const MAX_DICTATION_BYTES = 12 * 1024 * 1024;
/** Less speech than this is a tap or a cough: not worth sending to speech-to-text. */
export const MIN_SPEECH_MS = 250;
/** A guard for "unlimited" plans: about 8 hours of nonstop talking a day. */
export const DAILY_DICTATIONS = 3000;

export const MAX_WORDS = 500;
export const MAX_SNIPPETS = 100;

export type VoiceBot = { id: string; name: string; paused: boolean };

/** "Hey Otto, …" is answered in a small bubble at the bottom of the screen, so the reply is kept short. */
export const VOICE_DIRECTIVE =
  "The owner just asked this by voice from their computer (voice typing), and your reply shows in a small bubble at the bottom of their screen. Reply in 1 to 3 short sentences of plain text: no markdown, lists or headings. If you did something, say what. If the full answer is long, give the short version and say the rest is in the chat.";

export type VoiceContext = {
  words: DictionaryEntry[];
  snippets: DictionaryEntry[];
  bots: VoiceBot[];
  /** Names and words to spell right: the dictionary first, then names, then what the bots remember. */
  vocabulary: string[];
  /** The part of `vocabulary` that came from the bots' memories (shown on the Voice typing page). */
  fromMemories: string[];
};

function nameParts(owner: Pick<User, "name">): string[] {
  const name = owner.name?.trim();
  if (!name) return [];
  return [name, ...name.split(/\s+/).filter((p) => p.length > 1)];
}

/** Everything a dictation needs to spell the owner's world right. */
export async function loadVoiceContext(db: Db, owner: Pick<User, "id" | "name">): Promise<VoiceContext> {
  const [entries, bots] = await Promise.all([
    db.select().from(schema.dictionary).where(eq(schema.dictionary.ownerId, owner.id)).orderBy(desc(schema.dictionary.updatedAt)),
    db.select({ id: schema.bots.id, name: schema.bots.name, status: schema.bots.status }).from(schema.bots).where(eq(schema.bots.ownerId, owner.id)),
  ]);
  const memories = bots.length
    ? await db
        .select({ text: schema.memories.text })
        .from(schema.memories)
        .where(inArray(schema.memories.botId, bots.map((b) => b.id)))
        .orderBy(desc(schema.memories.pinned), desc(schema.memories.updatedAt))
        .limit(400)
    : [];
  const words = entries.filter((e) => e.kind === "word");
  const snippets = entries.filter((e) => e.kind === "snippet");
  const fixed = uniqueWords([...words.map((w) => w.text), ...nameParts(owner), ...bots.map((b) => b.name)]);
  const known = new Set(fixed.map((w) => w.toLowerCase()));
  const fromMemories = properNouns(memories.map((m) => m.text)).filter((w) => !known.has(w.toLowerCase()));
  return {
    words,
    snippets,
    bots: bots.map((b) => ({ id: b.id, name: b.name, paused: b.status === "paused" })),
    vocabulary: uniqueWords([...fixed, ...fromMemories]),
    fromMemories,
  };
}

/** Voice typing can run: a speech-to-text key, or demo mode. */
export function voiceTypingAvailable(): boolean {
  return Boolean(transcriptionSetup()) || demoMode;
}

/** The AI cleanup can run (or is simulated in demo mode). */
export function voicePolishAvailable(): boolean {
  return Boolean(polishSetup()) || demoMode;
}

export type DictateInput = {
  audio: ArrayBuffer;
  mime: string;
  durationMs: number;
  /** How long the recorder heard speech (above its silence level), when it measured it. */
  speechMs?: number;
  /** What kind of app the cursor is in, for the style. */
  category?: AppCategory;
  /** "Slack", "Mail". */
  appName?: string;
  /** ISO 639-1 ("en", "es"), or unset to detect it. */
  language?: string;
  /** The AI cleanup. Off: just the plain cleanup. */
  polish: boolean;
  /** "Hey {bot}, …" is for the bot. */
  commands: boolean;
  /** Match the app's style. */
  styles: boolean;
  /** Demo mode only: which line the demo hears ("command" for "Hey {bot}, …"). */
  demoSample?: DemoSample;
};

export type DictateResult =
  /** Nothing worth typing was heard. */
  | { kind: "empty" }
  | {
      kind: "text";
      /** What to type. */
      text: string;
      /** What speech-to-text heard, before any cleanup (for "Show what I said"). */
      heard: string;
      /** The AI cleanup ran and was used. */
      polished: boolean;
      words: number;
    }
  | {
      kind: "command";
      bot: VoiceBot;
      /** What to ask the bot ("Remind me to call Mom at 5"). Empty when they only said its name. */
      command: string;
      /** The whole dictation cleaned up, to type instead if it wasn't meant for the bot. */
      text: string;
      heard: string;
    };

export type DictateUsage = { words: number; limit: number | null };

export type DictateOutcome =
  | { ok: true; result: DictateResult; usage: DictateUsage; simulated: boolean; ms: { stt: number; polish: number } }
  | { ok: false; status: number; code: string; error: string; upgrade?: "plus" | "pro" };

function usageOf(owner: Pick<User, "plan">, used: number): DictateUsage {
  const limit = getPlan(owner.plan).limits.dictationWords;
  return { words: used, limit: Number.isFinite(limit) ? limit : null };
}

/** The plan's words this month: used and limit (null = unlimited). */
export async function dictationUsage(db: Db, owner: Pick<User, "id" | "plan">): Promise<DictateUsage> {
  return usageOf(owner, (await getUsage(db, owner.id)).dictationWords);
}

/** Speech-to-text costs about $0.04 an audio hour, billed at least 10 seconds a request. */
const sttCostMicros = (ms: number) => Math.max(10, ms / 1000) * (0.04 / 3600) * 1_000_000;

export async function dictate(db: Db, owner: User, input: DictateInput): Promise<DictateOutcome> {
  if (!voiceTypingAvailable()) return { ok: false, status: 503, code: "unavailable", error: "Voice typing is coming soon." };
  if (input.durationMs < 1 || input.durationMs > MAX_DICTATION_MS) return { ok: false, status: 422, code: "too_long", error: "A dictation can be up to 10 minutes." };
  if (input.audio.byteLength > MAX_DICTATION_BYTES) return { ok: false, status: 413, code: "too_large", error: "That recording is too large." };

  const limit = await checkLimit(db, owner, "dictationWords");
  if (!limit.ok) return { ok: false, status: 402, code: "limit", error: limit.message, upgrade: limit.plan.id === "free" ? "plus" : "pro" };
  const before = (await getUsage(db, owner.id)).dictationWords;

  // A tap, or a recording with no speech in it: nothing to send (and nothing to pay for).
  if ((input.speechMs !== undefined && input.speechMs < MIN_SPEECH_MS) || input.audio.byteLength < 400) {
    return { ok: true, result: { kind: "empty" }, usage: usageOf(owner, before), simulated: !transcriptionSetup(), ms: { stt: 0, polish: 0 } };
  }

  // "Unlimited" plans are for people, not scripts; and the whole site has a daily ceiling.
  const today = await rateLimit(db, `dictate-day:${owner.id}`, DAILY_DICTATIONS, 86_400);
  if (!today.ok) return { ok: false, status: 429, code: "daily", error: "That's a lot of voice typing for one day. It resets tomorrow." };
  if (!(await underDailyCeiling(db, "dictation"))) return { ok: false, status: 503, code: "busy", error: "Voice typing is very busy today. Try again in a little while." };

  const ctx = await loadVoiceContext(db, owner);
  const prompt = whisperPrompt(ctx.vocabulary);
  const simulated = !transcriptionSetup();

  // 2. Speech-to-text.
  const t0 = Date.now();
  let heard = "";
  if (simulated) {
    heard = demoHeard(input.demoSample, input.audio.byteLength, ctx.bots[0]?.name ?? null);
  } else {
    try {
      const result = await transcribe({ audio: input.audio, mime: input.mime, durationMs: input.durationMs, prompt, language: input.language, track: "mic", chunk: 0 });
      heard = result.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
      if (isPromptEcho(heard, prompt)) heard = "";
      // Whisper "hears" "Thank you." in a cough; a short real "Thanks!" has more speech than this.
      if (input.speechMs !== undefined && input.speechMs < 500 && isPhantom(heard)) heard = "";
    } catch (err) {
      if (err instanceof TranscriptionError && err.retryable) return { ok: false, status: 503, code: "busy", error: "Speech-to-text is busy. Try again in a moment." };
      return { ok: false, status: 422, code: "unreadable", error: "I couldn't make out that recording." };
    }
  }
  const stt = Date.now() - t0;
  let costMicros = simulated ? 0 : sttCostMicros(input.durationMs);

  const done = async (result: DictateResult, words: number, polishMs: number): Promise<DictateOutcome> => {
    if (words || costMicros) await recordUsage(db, owner.id, { dictationWords: words, costMicros });
    return { ok: true, result, usage: usageOf(owner, before + words), simulated, ms: { stt, polish: polishMs } };
  };

  if (!heard) return done({ kind: "empty" }, 0, 0);

  // 3. "Hey Otto, …"
  if (input.commands) {
    const cmd = matchCommand(heard, ctx.bots);
    if (cmd) return done({ kind: "command", bot: cmd.bot, command: cmd.command, text: applyDictionary(tidyTranscript(heard), ctx.words), heard }, 0, 0);
  }

  // 4. The cleanup.
  const t1 = Date.now();
  const tidy = tidyTranscript(heard);
  const guarded = protectSnippets(tidy, ctx.snippets);
  let text: string | null = null;
  let polished = false;
  // Short, clean and nothing to fix: the plain cleanup is what they meant, with no wait for a model.
  // (A snippet gets the AI's touch, for the punctuation around it.)
  const worthIt = guarded.slots.length > 0 || needsPolish(tidy, { category: input.category, vocabulary: ctx.vocabulary, language: input.language });
  if (input.polish && countWords(tidy) >= 3 && worthIt) {
    if (simulated) {
      text = guarded.slots.length ? null : demoPolish(heard);
    } else {
      const ai = await polishText({ text: guarded.text, vocabulary: ctx.vocabulary, category: input.category ?? "other", appName: input.appName, styles: input.styles });
      if (ai) {
        text = restoreSnippets(ai.text, guarded.slots);
        costMicros += ai.costMicros;
      }
    }
    polished = text !== null;
  }
  text ??= restoreSnippets(guarded.text, guarded.slots) ?? tidy;
  text = applyDictionary(text, ctx.words).trim();
  const polishMs = Date.now() - t1;
  if (!text) return done({ kind: "empty" }, 0, polishMs);

  // 5. The meter.
  const words = countWords(text);
  return done({ kind: "text", text, heard, polished, words }, words, polishMs);
}

// ---------------------------------------------------------------------------
// The dictionary
// ---------------------------------------------------------------------------

export type DictionaryView = { id: string; kind: "word" | "snippet"; text: string; heard: string[]; source: string; updatedAt: string };

export function dictionaryView(e: DictionaryEntry): DictionaryView {
  return { id: e.id, kind: e.kind === "snippet" ? "snippet" : "word", text: e.text, heard: e.heard ?? [], source: e.source, updatedAt: e.updatedAt.toISOString() };
}

export async function listDictionary(db: Db, ownerId: string): Promise<DictionaryEntry[]> {
  return db.select().from(schema.dictionary).where(eq(schema.dictionary.ownerId, ownerId)).orderBy(desc(schema.dictionary.updatedAt));
}

export async function getDictionaryEntry(db: Db, ownerId: string, id: string): Promise<DictionaryEntry | null> {
  const [row] = await db
    .select()
    .from(schema.dictionary)
    .where(and(eq(schema.dictionary.id, id), eq(schema.dictionary.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Editing by voice
// ---------------------------------------------------------------------------

export type EditByVoiceInput = {
  /** What they said to do, as voice typing heard it (the plain cleanup, no AI). */
  instruction: string;
  /** What they had selected; nothing means "write it at the cursor". */
  selection?: string | null;
  category?: AppCategory;
  appName?: string;
  styles: boolean;
};

export type EditOutcome =
  | { ok: true; kind: "replace" | "answer"; text: string; words: number; usage: DictateUsage; simulated: boolean; ms: number }
  | { ok: false; status: number; code: string; error: string; upgrade?: "plus" | "pro" };

/** Editing by voice can run: a model for it, or demo mode. */
export function voiceEditAvailable(): boolean {
  return Boolean(polishSetup()) || demoMode;
}

/**
 * Change the selection the way they said, or write what they asked for (edit.ts). Same limits as a
 * dictation; the words it types count toward the plan's words. Nothing is stored.
 */
export async function editByVoice(db: Db, owner: User, input: EditByVoiceInput): Promise<EditOutcome> {
  const instruction = input.instruction.trim();
  const selection = input.selection && input.selection.trim() ? input.selection : null;
  if (!instruction) return { ok: false, status: 422, code: "empty", error: "Say what to change." };
  if (!selection && needsSelection(instruction)) return { ok: false, status: 422, code: "no-selection", error: "Select the text you want to change first." };
  const setup = polishSetup();
  if (!setup && !demoMode) return { ok: false, status: 503, code: "unavailable", error: "Editing by voice isn't set up on this server yet." };

  const limit = await checkLimit(db, owner, "dictationWords");
  if (!limit.ok) return { ok: false, status: 402, code: "limit", error: limit.message, upgrade: limit.plan.id === "free" ? "plus" : "pro" };
  const today = await rateLimit(db, `dictate-day:${owner.id}`, DAILY_DICTATIONS, 86_400);
  if (!today.ok) return { ok: false, status: 429, code: "daily", error: "That's a lot of voice typing for one day. It resets tomorrow." };
  if (!(await underDailyCeiling(db, "dictation"))) return { ok: false, status: 503, code: "busy", error: "Voice typing is very busy today. Try again in a little while." };

  const t0 = Date.now();
  let result: { kind: "replace" | "answer"; text: string };
  let costMicros = 0;
  if (!setup) {
    result = demoEdit(instruction, selection);
  } else {
    const ctx = await loadVoiceContext(db, owner);
    const out = await editText({ instruction, selection, category: input.category ?? "other", appName: input.appName, vocabulary: ctx.vocabulary, styles: input.styles });
    if ("error" in out) {
      if (out.error === "timeout") return { ok: false, status: 504, code: "timeout", error: "That took too long. Try a shorter selection." };
      if (out.error === "unavailable") return { ok: false, status: 503, code: "unavailable", error: "Editing by voice isn't set up on this server yet." };
      return { ok: false, status: 502, code: "failed", error: "I couldn't do that one. Try saying it another way." };
    }
    result = { kind: out.kind, text: out.text };
    costMicros = out.costMicros;
  }
  const words = result.kind === "replace" ? countWords(result.text) : 0;
  if (words || costMicros) await recordUsage(db, owner.id, { dictationWords: words, costMicros });
  return { ok: true, ...result, words, usage: usageOf(owner, (await getUsage(db, owner.id)).dictationWords), simulated: !setup, ms: Date.now() - t0 };
}
