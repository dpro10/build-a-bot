/**
 * The speech server's pieces that don't touch the network: which NVIDIA model hears which
 * language, what kind of audio a file is, turning it into the WAV NeMo-Speech.cpp reads, and
 * shaping NeMo-Speech.cpp's answer like OpenAI's /audio/transcriptions (verbose_json), which is
 * what Build-a-bot's speech-to-text layer speaks.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** NVIDIA Parakeet TDT 0.6B v3: the most accurate of the two, and the faster one on a CPU. */
export const PARAKEET_LANGUAGES = new Set([
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
  "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
]);

/**
 * NVIDIA Nemotron 3.5 ASR: the languages Parakeet doesn't speak (Japanese, Chinese, Hindi, Arabic…).
 * It takes the language as a locale prompt; bare codes aren't all understood, so they're mapped.
 */
export const NEMOTRON_LOCALES = {
  ar: "ar-AR", bg: "bg-BG", cs: "cs-CZ", da: "da-DK", de: "de-DE", en: "en-US", es: "es-US",
  et: "et-EE", fi: "fi-FI", fr: "fr-FR", hi: "hi-IN", hr: "hr-HR", hu: "hu-HU", it: "it-IT",
  ja: "ja-JP", ko: "ko-KR", nb: "nb-NO", nl: "nl-NL", no: "nb-NO", pl: "pl-PL", pt: "pt-BR",
  ro: "ro-RO", ru: "ru-RU", sk: "sk-SK", sv: "sv-SE", tr: "tr-TR", uk: "uk-UA", vi: "vi-VN",
  zh: "zh-CN",
};

export const MODELS = {
  parakeet: { id: "parakeet-tdt-0.6b-v3", label: "NVIDIA Parakeet TDT 0.6B v3" },
  nemotron: { id: "nemotron-3.5-asr-streaming-0.6b", label: "NVIDIA Nemotron 3.5 ASR" },
};

/** "en", "en-US", "EN_us" → "en"; "", "auto" → null; anything else that isn't a language → undefined. */
export function languageOf(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v === "auto") return null;
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})*$/.exec(v);
  return m ? m[1] : undefined;
}

/**
 * Which model hears this: Parakeet for "detect it" and its 25 languages, Nemotron for the rest of
 * its own. A request can ask for Nemotron by name. null: neither speaks the language.
 */
export function route(language, { nemotron, model } = {}) {
  const wantsNemotron = /nemotron/i.test(String(model ?? ""));
  if (wantsNemotron && nemotron) {
    return { model: "nemotron", locale: language ? NEMOTRON_LOCALES[language] ?? null : null };
  }
  if (!language || PARAKEET_LANGUAGES.has(language)) return { model: "parakeet", locale: null };
  if (nemotron && NEMOTRON_LOCALES[language]) return { model: "nemotron", locale: NEMOTRON_LOCALES[language] };
  return null;
}

/** What kind of audio file this is, from its first bytes (and the ffmpeg demuxer that reads it). */
export function sniffAudio(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const ascii = (start, end) => b.toString("latin1", start, end);
  if (b.length < 12) return null;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { kind: "wav", demuxer: "wav" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "webm", demuxer: "matroska" };
  if (ascii(0, 4) === "OggS") return { kind: "ogg", demuxer: "ogg" };
  if (ascii(0, 4) === "fLaC") return { kind: "flac", demuxer: "flac" };
  if (ascii(4, 8) === "ftyp") return { kind: "mp4", demuxer: "mov" };
  if (ascii(0, 3) === "ID3") return { kind: "mp3", demuxer: "mp3" };
  // ADTS AAC: 12-bit sync and layer 00.
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { kind: "aac", demuxer: "aac" };
  // An MPEG audio frame: 11-bit sync, a real version and layer.
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x18) !== 0x08 && (b[1] & 0x06) !== 0) return { kind: "mp3", demuxer: "mp3" };
  return null;
}

/** Sample rate, channels, bits and the length of a PCM WAV, from its chunks. */
export function wavInfo(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 12 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
  let fmt = null;
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("latin1", at, at + 4);
    let size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= b.length) {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt) return null;
      // A header written to a pipe can say "unknown" (0 or 0xFFFFFFFF): the rest of the file is the data.
      if (size === 0 || size === 0xffffffff || body + size > b.length) size = b.length - body;
      const frame = fmt.channels * (fmt.bits / 8);
      const seconds = frame && fmt.sampleRate ? size / frame / fmt.sampleRate : 0;
      return { ...fmt, dataOffset: body, dataBytes: size, seconds };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** A private folder in RAM when there is one (/dev/shm), so the audio never touches a disk. */
async function scratchDir() {
  const base = existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir();
  return mkdtemp(path.join(base, "speech-"));
}

export class AudioError extends Error {}

/**
 * Any recording → 16 kHz mono 16-bit WAV, with `padSeconds` of silence at the end (without it,
 * the last word of a clip that stops mid-word comes out cut, or not at all). Runs ffmpeg with the
 * container forced from the sniffed type and only local files allowed, so a crafted upload (a
 * playlist pointing elsewhere) can't make it fetch anything. The files are deleted right after.
 */
export async function toWav16k(input, { ffmpeg = "ffmpeg", padSeconds = 1, maxSeconds = 1800, timeoutMs = 60_000 } = {}) {
  const kind = sniffAudio(input);
  if (!kind) throw new AudioError("unsupported_format");
  const dir = await scratchDir();
  const src = path.join(dir, `in.${kind.kind}`);
  const out = path.join(dir, "out.wav");
  try {
    await writeFile(src, input, { mode: 0o600 });
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-protocol_whitelist", "file",
      "-f", kind.demuxer, "-i", src,
      "-vn", "-sn", "-dn", "-map", "0:a:0",
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      "-af", `apad=pad_dur=${padSeconds}`,
      "-t", String(maxSeconds + padSeconds + 1),
      "-f", "wav", "-y", out,
    ];
    await run(ffmpeg, args, timeoutMs);
    const wav = await readFile(out);
    const info = wavInfo(wav);
    if (!info || info.dataBytes < 3200) throw new AudioError("unreadable_audio");
    return { wav, seconds: Math.max(0, info.seconds - padSeconds), kind: kind.kind };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      if (err.length < 2000) err += d;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new AudioError(signal ? "audio_timeout" : "unreadable_audio"));
    });
  });
}

/**
 * A clock time Parakeet writes British-style after an English time word: "at 3.30" → "at 3:30".
 * Not when a unit or "percent" follows ("at 2.25 percent" stays), and not after other words.
 */
const CLOCK_TIME =
  /\b(at|by|until|till|before|after|around|from|between)\s+(1[0-2]|[1-9])\.([0-5]\d)(?=\s*(?:[ap]\.?m\.?)?(?:[\s,;:!?)]|\.(?:\s|$)|$))(?!\s*(?:%|percent|per\b|times\b|x\b|dollars?|cents?|euros?|pounds?|points?|degrees?|kg\b|km\b|miles?|meters?|feet|inches|lbs?\b|gb\b|mb\b|million|billion|thousand))/gi;

/**
 * NeMo's text, the way people write it: inverse text normalization writes "three thirty" as
 * "03:30", so the hour's leading zero goes; "at 3.30" gets a colon; Nemotron's language tag
 * ("<en-US>") goes.
 */
export function tidyText(text) {
  return String(text ?? "")
    .replace(/\s*<[a-z]{2,3}(?:-[A-Za-z]{2,4})?>\s*/g, " ")
    .replace(/(^|[^\d:])0([1-9]):([0-5]\d)(?!\d)/g, "$1$2:$3")
    .replace(CLOCK_TIME, "$1 $2:$3")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE_END = /[.!?…。！？][)"'”’\]]*$/;

/**
 * Words with times → sentence-sized segments (a new one after a sentence ends, after a pause, and
 * at most every `maxSeconds`), as Whisper-style segments: meeting notes show and search them.
 */
export function segmentsFromWords(words, { maxSeconds = 30, pauseSeconds = 1.2, endSeconds = Infinity } = {}) {
  const out = [];
  let cur = null;
  for (const w of Array.isArray(words) ? words : []) {
    const text = String(w?.word ?? "").trim();
    if (!text) continue;
    const start = clamp(Number(w.start) || 0, 0, endSeconds);
    const end = clamp(Math.max(start, Number(w.end) || start), start, endSeconds);
    if (cur) {
      const gap = start - cur.end;
      const sentenceDone = SENTENCE_END.test(cur.text);
      if (gap >= pauseSeconds || (sentenceDone && end - cur.start > 2) || end - cur.start > maxSeconds) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) {
      cur.text += ` ${text}`;
      cur.end = end;
    } else {
      cur = { start, end, text };
    }
  }
  if (cur) out.push(cur);
  return out.map((s, id) => ({ id, start: round(s.start), end: round(s.end), text: tidyText(s.text) })).filter((s) => s.text);
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * NeMo-Speech.cpp's verbose_json ({text, duration, language, words}) → OpenAI's
 * (task, language, duration, text, segments, and words when asked for).
 */
export function openAiTranscription(nemo, { seconds, model, language, withWords = false }) {
  const text = tidyText(nemo?.text);
  const words = Array.isArray(nemo?.words) ? nemo.words : [];
  let segments = segmentsFromWords(words, { endSeconds: seconds });
  if (!segments.length && text) segments = [{ id: 0, start: 0, end: round(seconds), text }];
  const detected = typeof nemo?.language === "string" && nemo.language ? nemo.language.split("-")[0].toLowerCase() : null;
  const out = {
    task: "transcribe",
    language: detected ?? language ?? "",
    duration: round(seconds),
    text,
    model,
    segments: segments.map((s) => ({ ...s, seek: 0, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 1, no_speech_prob: 0 })),
  };
  if (withWords) {
    out.words = words
      .map((w) => ({ word: tidyText(w.word), start: round(clamp(Number(w.start) || 0, 0, seconds)), end: round(clamp(Number(w.end) || 0, 0, seconds)) }))
      .filter((w) => w.word);
  }
  return out;
}
