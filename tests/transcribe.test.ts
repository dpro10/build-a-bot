/**
 * The speech-to-text client against a fake OpenAI-shaped endpoint: timestamps,
 * models that only return text, the fallback provider, and what counts as retryable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.TRANSCRIBE_PROVIDER = "groq";
process.env.TRANSCRIBE_API_KEY = "gsk_test_primary";
process.env.TRANSCRIBE_FALLBACK_PROVIDER = "together";
process.env.TRANSCRIBE_FALLBACK_API_KEY = "tg_test_fallback";

const { transcribe, transcriptionSetup, TranscriptionError } = await import("@/lib/transcribe");

const input = { audio: new ArrayBuffer(3000), mime: "audio/webm;codecs=opus", durationMs: 20_000, track: "mic" as const, chunk: 3, prompt: "Earlier: we talked about the launch." };

type Call = { url: string; auth: string | null; form: FormData };

function fakeFetch(responses: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, auth: new Headers(init.headers).get("authorization"), form: init.body as FormData };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next(call);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech-to-text", () => {
  it("uses Groq's Whisper turbo by default and keeps the segment timestamps", async () => {
    expect(transcriptionSetup()).toMatchObject({ provider: "groq", model: "whisper-large-v3-turbo", baseUrl: "https://api.groq.com/openai/v1" });
    const calls = fakeFetch([
      () =>
        Response.json({
          text: "Hi all. Let's start.",
          segments: [
            { start: 0.4, end: 1.8, text: " Hi all.", no_speech_prob: 0.01, avg_logprob: -0.2 },
            { start: 2, end: 3.5, text: " Let's start.", no_speech_prob: 0.02, avg_logprob: -0.25 },
          ],
        }),
    ]);
    const out = await transcribe(input);
    expect(out).toMatchObject({ provider: "groq", simulated: false });
    expect(out.segments).toEqual([
      { startMs: 400, endMs: 1800, text: "Hi all." },
      { startMs: 2000, endMs: 3500, text: "Let's start." },
    ]);
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[0].auth).toBe("Bearer gsk_test_primary");
    expect(calls[0].form.get("model")).toBe("whisper-large-v3-turbo");
    expect(calls[0].form.get("response_format")).toBe("verbose_json");
    expect(calls[0].form.get("timestamp_granularities[]")).toBe("segment");
    expect(calls[0].form.get("prompt")).toBe(input.prompt);
    expect((calls[0].form.get("file") as File).name).toBe("chunk.webm");
  });

  it("reports how long the audio really was (what speech-to-text bills), whatever the recorder said", async () => {
    fakeFetch([() => Response.json({ duration: 1500.25, segments: [{ start: 0, end: 2, text: "Long one." }] })]);
    const out = await transcribe({ ...input, durationMs: 1000 });
    expect(out.audioMs).toBe(1_500_250);
    fakeFetch([() => Response.json({ text: "No duration here." })]);
    expect((await transcribe(input)).audioMs).toBeUndefined();
  });

  it("falls back to plain text for models without timestamps", async () => {
    const calls = fakeFetch([
      () => new Response(JSON.stringify({ error: { message: "response_format 'verbose_json' is not compatible with this model" } }), { status: 400 }),
      () => Response.json({ text: "The whole chunk as one line." }),
    ]);
    const out = await transcribe(input);
    expect(calls[1].form.get("response_format")).toBe("json");
    expect(out.segments).toEqual([{ startMs: 0, endMs: 20_000, text: "The whole chunk as one line." }]);
  });

  it("switches to the fallback provider when the main one is rate-limited", async () => {
    const calls = fakeFetch([
      () => new Response("slow down", { status: 429 }),
      () => Response.json({ segments: [{ start: 1, end: 2, text: "From Together." }] }),
    ]);
    const out = await transcribe(input);
    expect(out.provider).toBe("together");
    expect(calls[1].url).toBe("https://api.together.ai/v1/audio/transcriptions");
    expect(calls[1].auth).toBe("Bearer tg_test_fallback");
    // Together's default is NVIDIA Parakeet (it takes no prompt).
    expect(calls[1].form.get("model")).toBe("nvidia/parakeet-tdt-0.6b-v3");
    expect(calls[1].form.get("prompt")).toBeNull();
  });

  it("network failures are retryable; unreadable audio is not", async () => {
    fakeFetch([
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    const err = await transcribe(input).catch((e) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect(err.retryable).toBe(true);

    fakeFetch([() => new Response(JSON.stringify({ error: { message: "could not decode audio" } }), { status: 400 })]);
    const bad = await transcribe(input).catch((e) => e);
    expect(bad.retryable).toBe(false);

    const wrongType = await transcribe({ ...input, mime: "video/quicktime" }).catch((e) => e);
    expect(wrongType.retryable).toBe(false);
  });
});
