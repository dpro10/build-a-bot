/**
 * Voice typing: hold a key anywhere, talk, let go, and what you meant is typed where your cursor
 * is (the desktop app pastes it).
 *
 * One dictation, in order:
 *  1. Credit (speech-to-text here and the AI cleanup are paid from it, at cost; out of credit, what
 *     the computer heard still gets the plain cleanup), and the daily caps.
 *  2. Speech-to-text (NVIDIA Parakeet by default). Models that take hints (Whisper) are steered
 *     toward the owner's words (their dictionary, their bots' names, the names their bots
 *     remember); with NVIDIA's, a word that sounds like one of theirs sends the text through the AI
 *     cleanup, which knows them.
 *  3. "Hey Otto, …" at the start is a request for the bot: it goes back as a command (the caller
 *     runs it with /api/voice/ask), and isn't typed.
 *  4. Otherwise the cleanup: the plain one (tidyTranscript), then the AI one (polish.ts) when it's
 *     on and checks out, then the owner's spellings and snippets.
 *  5. The words typed are counted, and what it cost is paid from credit.
 *
 * The audio is transcribed in memory and thrown away; what was said is never stored or logged.
 * Only the number of words is kept (Credit & usage shows it).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { DictionaryEntry, User } from "@/lib/db/schema";
import { roomToday, spenderOf, type Room } from "@/lib/billing/ceiling";
import { getUsage, recordUsage } from "@/lib/billing/usage";
import { creditRefusal } from "@/lib/billing/credit";
import { demoMode, demoSpeech } from "@/lib/env";
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
/** What 10 minutes of fast talking comes to, with room to spare. */
export const MAX_HEARD_CHARS = 20_000;
/** Less speech than this is a tap or a cough: not worth sending to speech-to-text. */
export const MIN_SPEECH_MS = 250;
/** A guard for "unlimited" plans: about 8 hours of nonstop talking a day. */
export const DAILY_DICTATIONS = 3000;

/** Why voice typing can't take more today, by what ran out (billing/ceiling.ts). */
const DICTATION_CEILING: Record<Exclude<Room, "ok">, string> = {
  site: "Voice typing is very busy today. Try again in a little while.",
  account: "That's a lot of voice typing for one day. It resets tomorrow.",
  guests: "Voice typing is very busy today for accounts that haven't signed in. Sign in with your email to keep going.",
  network: "Voice typing is very busy today for accounts that haven't signed in. Sign in with your email to keep going.",
};

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

/**
 * Recordings can be turned into text here: a speech-to-text key (or scripted speech, in tests).
 * Without one, voice typing still works: the desktop app hears its owner on their computer (NVIDIA
 * Parakeet) and sends only the words.
 */
export function speechToTextAvailable(): boolean {
  return Boolean(transcriptionSetup()) || demoSpeech;
}

/** The AI cleanup can run (or is simulated in demo mode). */
export function voicePolishAvailable(): boolean {
  return Boolean(polishSetup()) || demoMode;
}

export type DictateInput = {
  /** The recording. Or, instead, `heard`. */
  audio?: ArrayBuffer;
  mime?: string;
  /**
   * What the owner's own computer already heard (the desktop app runs NVIDIA Parakeet on the
   * device): no audio reaches the server, and no speech-to-text runs here.
   */
  heard?: string;
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

/** Words typed this month. There's no monthly limit (people pay for what they use); `limit` stays for older apps. */
export type DictateUsage = { words: number; limit: number | null };

export type DictateOutcome =
  | { ok: true; result: DictateResult; usage: DictateUsage; simulated: boolean; ms: { stt: number; polish: number } }
  | { ok: false; status: number; code: string; error: string };

function usageOf(used: number): DictateUsage {
  return { words: used, limit: null };
}

/** Words typed by voice this month. */
export async function dictationUsage(db: Db, owner: Pick<User, "id">): Promise<DictateUsage> {
  return usageOf((await getUsage(db, owner.id)).dictationWords);
}

export async function dictate(db: Db, owner: User, input: DictateInput): Promise<DictateOutcome> {
  // Heard on the owner's computer: this server only cleans it up, so it needs no speech-to-text.
  const onDevice = input.heard !== undefined;
  if (!onDevice && !speechToTextAvailable()) return { ok: false, status: 503, code: "unavailable", error: "This server doesn't turn recordings into text: the desktop app hears you on your computer." };
  if (input.durationMs < 1 || input.durationMs > MAX_DICTATION_MS) return { ok: false, status: 422, code: "too_long", error: "A dictation can be up to 10 minutes." };
  if ((input.audio?.byteLength ?? 0) > MAX_DICTATION_BYTES) return { ok: false, status: 413, code: "too_large", error: "That recording is too large." };
  if ((input.heard?.length ?? 0) > MAX_HEARD_CHARS) return { ok: false, status: 413, code: "too_large", error: "That dictation is too long." };
  if (!onDevice && !input.audio) return { ok: false, status: 422, code: "unreadable", error: "I couldn't make out that recording." };

  const before = (await getUsage(db, owner.id)).dictationWords;

  // A tap, or a recording with no speech in it: nothing to send (and nothing to pay for).
  if ((input.speechMs !== undefined && input.speechMs < MIN_SPEECH_MS) || (!onDevice && (input.audio?.byteLength ?? 0) < 400)) {
    return { ok: true, result: { kind: "empty" }, usage: usageOf(before), simulated: !onDevice && !transcriptionSetup(), ms: { stt: 0, polish: 0 } };
  }
  // What it costs: hearing it here (speech-to-text) and the AI cleanup are paid from credit; heard
  // on the computer it's free. Out of credit, a recording can't be heard here, and what was heard on
  // the computer gets the plain cleanup (still free) instead of the AI's.
  const refused = await creditRefusal(db, owner.id);
  const credit = !refused;
  if (!onDevice && transcriptionSetup() && refused) return { ok: false, status: 402, code: "no_credit", error: refused };

  // Voice typing is for people, not scripts: a daily cap per account, and one for the whole site.
  const today = await rateLimit(db, `dictate-day:${owner.id}`, DAILY_DICTATIONS, 86_400);
  if (!today.ok) return { ok: false, status: 429, code: "daily", error: "That's a lot of voice typing for one day. It resets tomorrow." };
  const room = await roomToday(db, "dictation", spenderOf(owner));
  if (room !== "ok") return { ok: false, status: 503, code: "busy", error: DICTATION_CEILING[room] };

  const ctx = await loadVoiceContext(db, owner);
  const prompt = whisperPrompt(ctx.vocabulary);
  const simulated = !onDevice && !transcriptionSetup();

  // 2. Speech-to-text (unless the owner's computer already did it).
  const t0 = Date.now();
  let heard = "";
  let costMicros = 0;
  if (onDevice) {
    heard = String(input.heard).replace(/\s+/g, " ").trim();
    if (input.speechMs !== undefined && input.speechMs < 500 && isPhantom(heard)) heard = "";
  } else if (simulated || !input.audio) {
    heard = demoHeard(input.demoSample, input.audio?.byteLength ?? 0, ctx.bots[0]?.name ?? null);
  } else {
    try {
      const result = await transcribe({ audio: input.audio, mime: input.mime ?? "audio/webm", durationMs: input.durationMs, prompt, language: input.language, track: "mic", chunk: 0 });
      costMicros = result.costMicros;
      heard = result.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
      if (result.prompted && isPromptEcho(heard, prompt)) heard = "";
      // Whisper "hears" "Thank you." in a cough; a short real "Thanks!" has more speech than this.
      if (input.speechMs !== undefined && input.speechMs < 500 && isPhantom(heard)) heard = "";
    } catch (err) {
      if (err instanceof TranscriptionError && err.retryable) return { ok: false, status: 503, code: "busy", error: "Speech-to-text is busy. Try again in a moment." };
      if (err instanceof TranscriptionError && err.code === "unsupported_language") return { ok: false, status: 422, code: "language", error: "Voice typing can't hear that language yet. Pick another one in settings, or “Detect it”." };
      return { ok: false, status: 422, code: "unreadable", error: "I couldn't make out that recording." };
    }
  }
  const stt = Date.now() - t0;

  const done = async (result: DictateResult, words: number, polishMs: number): Promise<DictateOutcome> => {
    if (words || costMicros) await recordUsage(db, owner.id, { dictationWords: words, costMicros });
    return { ok: true, result, usage: usageOf(before + words), simulated, ms: { stt, polish: polishMs } };
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
  if (input.polish && credit && countWords(tidy) >= 3 && worthIt) {
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
  | { ok: false; status: number; code: string; error: string };

/** Editing by voice can run: a model for it, or demo mode. */
export function voiceEditAvailable(): boolean {
  return Boolean(polishSetup()) || demoMode;
}

/**
 * Change the selection the way they said, or write what they asked for (edit.ts). Same checks as a
 * dictation (credit for the model, the daily limits); the words it types count as voice typing. Nothing is stored.
 */
export async function editByVoice(db: Db, owner: User, input: EditByVoiceInput): Promise<EditOutcome> {
  const instruction = input.instruction.trim();
  const selection = input.selection && input.selection.trim() ? input.selection : null;
  if (!instruction) return { ok: false, status: 422, code: "empty", error: "Say what to change." };
  if (!selection && needsSelection(instruction)) return { ok: false, status: 422, code: "no-selection", error: "Select the text you want to change first." };
  const setup = polishSetup();
  if (!setup && !demoMode) return { ok: false, status: 503, code: "unavailable", error: "Editing by voice isn't set up on this server yet." };

  // The model that does it is paid from credit (demo mode's rules are free).
  const refused = setup ? await creditRefusal(db, owner.id) : null;
  if (refused) return { ok: false, status: 402, code: "no_credit", error: refused };
  const today = await rateLimit(db, `dictate-day:${owner.id}`, DAILY_DICTATIONS, 86_400);
  if (!today.ok) return { ok: false, status: 429, code: "daily", error: "That's a lot of voice typing for one day. It resets tomorrow." };
  const room = await roomToday(db, "dictation", spenderOf(owner));
  if (room !== "ok") return { ok: false, status: 503, code: "busy", error: DICTATION_CEILING[room] };

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
  return { ok: true, ...result, words, usage: usageOf((await getUsage(db, owner.id)).dictationWords), simulated: !setup, ms: Date.now() - t0 };
}
