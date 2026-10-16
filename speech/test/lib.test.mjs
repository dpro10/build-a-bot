import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { AudioError, languageOf, openAiTranscription, route, segmentsFromWords, sniffAudio, tidyText, toWav16k, wavInfo } from "../lib.mjs";
import { tone, wav } from "./audio.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("language codes: ISO codes and locales, 'auto' and empty mean detect it", () => {
  assert.equal(languageOf("en"), "en");
  assert.equal(languageOf("en-US"), "en");
  assert.equal(languageOf("PT_br"), "pt");
  assert.equal(languageOf(""), null);
  assert.equal(languageOf("auto"), null);
  assert.equal(languageOf(null), null);
  assert.equal(languageOf("english"), undefined);
  assert.equal(languageOf("e"), undefined);
});

test("routing: Parakeet for 'detect it' and its 25 languages, Nemotron for the others it knows", () => {
  const both = { nemotron: true };
  assert.deepEqual(route(null, both), { model: "parakeet", locale: null });
  assert.deepEqual(route("en", both), { model: "parakeet", locale: null });
  assert.deepEqual(route("de", both), { model: "parakeet", locale: null });
  assert.deepEqual(route("uk", both), { model: "parakeet", locale: null });
  assert.deepEqual(route("ja", both), { model: "nemotron", locale: "ja-JP" });
  assert.deepEqual(route("zh", both), { model: "nemotron", locale: "zh-CN" });
  assert.deepEqual(route("no", both), { model: "nemotron", locale: "nb-NO" });
  assert.deepEqual(route("hi", both), { model: "nemotron", locale: "hi-IN" });
  // Neither model speaks Persian; without Nemotron, Japanese isn't heard either.
  assert.equal(route("fa", both), null);
  assert.equal(route("ja", { nemotron: false }), null);
  // Asking for Nemotron by name.
  assert.deepEqual(route("en", { nemotron: true, model: "nemotron-3.5-asr-streaming-0.6b" }), { model: "nemotron", locale: "en-US" });
  assert.deepEqual(route("en", { nemotron: false, model: "nemotron-3.5-asr-streaming-0.6b" }), { model: "parakeet", locale: null });
});

test("audio types are recognized from their first bytes, and nothing else is", () => {
  assert.equal(sniffAudio(wav(new Int16Array(800))).kind, "wav");
  assert.equal(sniffAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])).demuxer, "matroska");
  assert.equal(sniffAudio(Buffer.from("OggS\0\x02\0\0\0\0\0\0", "latin1")).kind, "ogg");
  assert.equal(sniffAudio(Buffer.from("fLaC\0\0\0\x22\0\0\0\0", "latin1")).kind, "flac");
  assert.equal(sniffAudio(Buffer.from("\0\0\0\x20ftypM4A \0\0", "latin1")).demuxer, "mov");
  assert.equal(sniffAudio(Buffer.from("ID3\x04\0\0\0\0\0\0\0\0", "latin1")).kind, "mp3");
  assert.equal(sniffAudio(Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0])).kind, "aac");
  assert.equal(sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])).kind, "mp3");
  assert.equal(sniffAudio(Buffer.from("#EXTM3U\nhttp://169.254.169.254/latest\n")), null);
  assert.equal(sniffAudio(Buffer.from("ffconcat version 1.0\nfile /etc/passwd\n")), null);
  assert.equal(sniffAudio(Buffer.from("short")), null);
});

test("wavInfo reads the format and length, past extra chunks and 'unknown length' headers", () => {
  const plain = wavInfo(wav(new Int16Array(16000)));
  assert.equal(plain.sampleRate, 16000);
  assert.equal(plain.channels, 1);
  assert.equal(plain.bits, 16);
  assert.equal(plain.seconds, 1);

  const withList = wav(new Int16Array(8000), { extraChunk: true });
  assert.equal(wavInfo(withList).seconds, 0.5);

  const piped = wav(new Int16Array(16000));
  piped.writeUInt32LE(0xffffffff, 40);
  assert.equal(wavInfo(piped).seconds, 1);

  assert.equal(wavInfo(Buffer.from("not a wav file at all")), null);
});

test("tidyText: '03:30' reads 3:30, other times and numbers are left alone, language tags go", () => {
  assert.equal(tidyText("Call me tomorrow at 03:30."), "Call me tomorrow at 3:30.");
  assert.equal(tidyText("03:30 works"), "3:30 works");
  assert.equal(tidyText("at 00:30"), "at 00:30");
  assert.equal(tidyText("at 10:05 or 12:45"), "at 10:05 or 12:45");
  assert.equal(tidyText("room 103:30"), "room 103:30");
  assert.equal(tidyText("Call Priya tomorrow at 3.30."), "Call Priya tomorrow at 3:30.");
  assert.equal(tidyText("Let's meet at 11.45 tomorrow, or by 1.15pm"), "Let's meet at 11:45 tomorrow, or by 1:15pm");
  assert.equal(tidyText("from 9.30 a.m. until 4.00"), "from 9:30 a.m. until 4:00");
  assert.equal(tidyText("The rate is at 2.25 percent"), "The rate is at 2.25 percent");
  assert.equal(tidyText("it sold at 1.50 dollars"), "it sold at 1.50 dollars");
  assert.equal(tidyText("Version 3.30 is out"), "Version 3.30 is out");
  assert.equal(tidyText("at 13.30"), "at 13.30");
  assert.equal(tidyText("at 3.75"), "at 3.75");
  assert.equal(tidyText("Hola, ¿qué tal? <es-US>"), "Hola, ¿qué tal?");
  assert.equal(tidyText("  two   spaces  "), "two spaces");
});

test("segments: one per sentence, a new one after a pause, none longer than the cap", () => {
  const words = [
    { word: "Hi", start: 0.1, end: 0.3 },
    { word: "Sam.", start: 0.35, end: 0.7 },
    { word: "The", start: 0.9, end: 1.0 },
    { word: "launch", start: 1.0, end: 1.4 },
    { word: "is", start: 1.4, end: 1.5 },
    { word: "Friday.", start: 1.5, end: 2.2 },
    { word: "Next,", start: 2.4, end: 2.8 },
    { word: "pricing", start: 2.8, end: 3.3 },
    { word: "stays", start: 5.0, end: 5.4 },
    { word: "at", start: 5.4, end: 5.5 },
    { word: "03:30.", start: 5.5, end: 6.0 },
  ];
  const segs = segmentsFromWords(words);
  assert.deepEqual(
    segs.map((s) => s.text),
    // "Hi Sam." is short, so it rides with the next sentence; the 1.7 s pause starts a new one.
    ["Hi Sam. The launch is Friday.", "Next, pricing", "stays at 3:30."],
  );
  assert.equal(segs[0].start, 0.1);
  assert.equal(segs[2].end, 6);

  const long = Array.from({ length: 100 }, (_, i) => ({ word: "word", start: i * 0.5, end: i * 0.5 + 0.4 }));
  assert.ok(segmentsFromWords(long, { maxSeconds: 10 }).every((s) => s.end - s.start <= 10));

  // Times past the end of the real audio (the silence added after it) are clamped.
  assert.equal(segmentsFromWords([{ word: "end.", start: 2.9, end: 3.6 }], { endSeconds: 3 })[0].end, 3);
  assert.deepEqual(segmentsFromWords([]), []);
  assert.deepEqual(segmentsFromWords([{ word: " ", start: 0, end: 1 }]), []);
});

test("NeMo's answer comes out shaped like OpenAI's verbose_json", () => {
  const nemo = {
    text: "Hey Otto, remind me at 03:30.",
    language: "",
    duration: 4.5,
    words: [
      { word: "Hey", start: 0, end: 0.2, confidence: 1 },
      { word: "Otto,", start: 0.3, end: 0.8, confidence: 1 },
      { word: "remind", start: 0.9, end: 1.2, confidence: 1 },
      { word: "me", start: 1.2, end: 1.3, confidence: 1 },
      { word: "at", start: 1.3, end: 1.5, confidence: 1 },
      { word: "03:30.", start: 1.5, end: 2.5, confidence: 1 },
    ],
  };
  const out = openAiTranscription(nemo, { seconds: 3.5, model: "parakeet-tdt-0.6b-v3", language: "en" });
  assert.equal(out.task, "transcribe");
  assert.equal(out.text, "Hey Otto, remind me at 3:30.");
  assert.equal(out.language, "en");
  assert.equal(out.duration, 3.5);
  assert.equal(out.segments.length, 1);
  assert.equal(out.segments[0].text, "Hey Otto, remind me at 3:30.");
  assert.equal(out.segments[0].no_speech_prob, 0);
  assert.equal(out.words, undefined);

  const withWords = openAiTranscription(nemo, { seconds: 3.5, model: "m", language: null, withWords: true });
  assert.equal(withWords.words.length, 6);
  assert.equal(withWords.words[5].word, "3:30.");
  assert.equal(withWords.language, "");

  // No word times (or no words): one segment over the whole clip.
  const bare = openAiTranscription({ text: "Hola." , language: "es-US" }, { seconds: 2, model: "m", language: "es" });
  assert.deepEqual(bare.segments.map((s) => [s.start, s.end, s.text]), [[0, 2, "Hola."]]);
  assert.equal(bare.language, "es");
  assert.deepEqual(openAiTranscription({ text: "" }, { seconds: 2, model: "m" }).segments, []);
});

test("any recording becomes 16 kHz mono WAV with a second of silence after it", { skip: !hasFfmpeg && "ffmpeg isn't installed" }, async () => {
  for (const [codec, ext] of [["libopus", "webm"], ["libopus", "ogg"], ["aac", "m4a"], ["flac", "flac"], ["pcm_s16le", "wav"]]) {
    const input = tone(2.5, { codec, ext, rate: 48000, channels: 2 });
    const out = await toWav16k(input, { padSeconds: 1 });
    const info = wavInfo(out.wav);
    assert.equal(info.sampleRate, 16000, ext);
    assert.equal(info.channels, 1, ext);
    assert.equal(info.bits, 16, ext);
    assert.ok(Math.abs(info.seconds - 3.5) < 0.1, `${ext}: ${info.seconds}s`);
    assert.ok(Math.abs(out.seconds - 2.5) < 0.1, `${ext}: reported ${out.seconds}s`);
  }
});

test("a file that isn't audio is refused before ffmpeg sees it", async () => {
  await assert.rejects(toWav16k(Buffer.from("#EXTM3U\n#EXTINF:1,\nhttp://example.com/a.wav\n")), (e) => e instanceof AudioError && e.message === "unsupported_format");
});

test("a broken recording is unreadable, not a crash", { skip: !hasFfmpeg && "ffmpeg isn't installed" }, async () => {
  const broken = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4000, 7)]);
  await assert.rejects(toWav16k(broken), (e) => e instanceof AudioError);
});
