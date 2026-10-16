/**
 * Speech-to-text on NVIDIA's models: our own speech server (speech/, on Nebius) first, NVIDIA
 * Parakeet on Together AI as the backup, and Whisper only for languages neither NVIDIA model hears.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SPEECH_URL = "https://speech.example.test/v1";

/** A fresh copy of the module, configured by these environment variables. */
async function load(env: Record<string, string | undefined>) {
  for (const k of Object.keys(process.env)) if (k.startsWith("TRANSCRIBE_")) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  vi.resetModules();
  return import("@/lib/transcribe");
}

const NVIDIA = { TRANSCRIBE_PROVIDER: "nvidia", TRANSCRIBE_BASE_URL: SPEECH_URL, TRANSCRIBE_API_KEY: "speech_key" };
const TOGETHER_BACKUP = { TRANSCRIBE_FALLBACK_PROVIDER: "together", TRANSCRIBE_FALLBACK_API_KEY: "tg_key" };

const input = { audio: new ArrayBuffer(3000), mime: "audio/webm;codecs=opus", durationMs: 6000, track: "mic" as const, chunk: 0, prompt: "Otto, Priya Raghunathan." };

type Call = { url: string; auth: string | null; form: FormData };

function fakeFetch(responses: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, auth: new Headers(init.headers).get("authorization"), form: init.body as FormData };
      calls.push(call);
      const next = responses.shift();
      if (!next) throw new Error(`unexpected call to ${url}`);
      return next(call);
    }),
  );
  return calls;
}

const verbose = (text: string, duration = 5.5) => () =>
  Response.json({ task: "transcribe", language: "en", duration, text, model: "parakeet-tdt-0.6b-v3", segments: [{ id: 0, start: 0.2, end: 2.4, text, no_speech_prob: 0, avg_logprob: 0 }] });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech-to-text on NVIDIA's models", () => {
  it("our speech server: Parakeet by default, no prompt (it takes no hints), the language passed on", async () => {
    const { transcribe, transcriptionSetup } = await load(NVIDIA);
    expect(transcriptionSetup()).toEqual({ provider: "nvidia", baseUrl: SPEECH_URL, model: "parakeet-tdt-0.6b-v3", label: "NVIDIA Parakeet and Nemotron on our speech server (Nebius)" });
    const calls = fakeFetch([verbose("Hey Otto, remind me at 3:30.")]);
    const out = await transcribe({ ...input, language: "en" });
    expect(calls[0].url).toBe(`${SPEECH_URL}/audio/transcriptions`);
    expect(calls[0].auth).toBe("Bearer speech_key");
    expect(calls[0].form.get("model")).toBe("parakeet-tdt-0.6b-v3");
    expect(calls[0].form.get("language")).toBe("en");
    expect(calls[0].form.get("prompt")).toBeNull();
    expect([...calls[0].form.keys()][0]).toBe("model");
    expect(out).toMatchObject({ provider: "nvidia", model: "parakeet-tdt-0.6b-v3", prompted: false, simulated: false, audioMs: 5500 });
    expect(out.segments).toEqual([{ startMs: 200, endMs: 2400, text: "Hey Otto, remind me at 3:30." }]);
    // About $0.05 an audio hour (the machine's price spread over what it can hear).
    expect(out.costMicros).toBe(Math.round(5.5 * (0.05 / 3600) * 1e6));
  });

  it("Japanese goes to our server too (it runs Nemotron for it); a language neither model hears goes straight to the backup's Whisper", async () => {
    const { transcribe } = await load({ ...NVIDIA, ...TOGETHER_BACKUP });
    let calls = fakeFetch([verbose("明日の会議")]);
    expect((await transcribe({ ...input, language: "ja" })).provider).toBe("nvidia");
    expect(calls).toHaveLength(1);

    calls = fakeFetch([verbose("سلام")]);
    const fa = await transcribe({ ...input, language: "fa" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.together.ai/v1/audio/transcriptions");
    expect(calls[0].form.get("model")).toBe("openai/whisper-large-v3");
    // Whisper takes hints, so the names go with it.
    expect(calls[0].form.get("prompt")).toBe(input.prompt);
    expect(fa).toMatchObject({ provider: "together", model: "openai/whisper-large-v3", prompted: true });
  });

  it("our server down or busy: NVIDIA Parakeet on Together takes over", async () => {
    const { transcribe } = await load({ ...NVIDIA, ...TOGETHER_BACKUP });
    const calls = fakeFetch([() => new Response(JSON.stringify({ error: { code: "busy" } }), { status: 503 }), verbose("From Together.")]);
    const out = await transcribe({ ...input, language: "de" });
    expect(calls[1].url).toBe("https://api.together.ai/v1/audio/transcriptions");
    expect(calls[1].form.get("model")).toBe("nvidia/parakeet-tdt-0.6b-v3");
    expect(calls[1].form.get("prompt")).toBeNull();
    expect(out).toMatchObject({ provider: "together", model: "nvidia/parakeet-tdt-0.6b-v3" });
    // $0.0015 a minute.
    expect(out.costMicros).toBe(Math.round(5.5 * (0.09 / 3600) * 1e6));
  });

  it("our server saying it can't hear a language sends that one to the backup", async () => {
    const { transcribe } = await load({ ...NVIDIA, ...TOGETHER_BACKUP });
    const calls = fakeFetch([
      () => new Response(JSON.stringify({ error: { code: "unsupported_language", message: "no" } }), { status: 422 }),
      verbose("Hola."),
    ]);
    const out = await transcribe({ ...input, language: "ko" });
    expect(calls).toHaveLength(2);
    expect(calls[1].form.get("model")).toBe("openai/whisper-large-v3");
    expect(out.provider).toBe("together");
  });

  it("with no backup, a language nobody hears is a clear, non-retryable error", async () => {
    const { transcribe, TranscriptionError } = await load(NVIDIA);
    const calls = fakeFetch([]);
    const err = await transcribe({ ...input, language: "fa" }).catch((e) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect(err).toMatchObject({ retryable: false, code: "unsupported_language" });
    expect(calls).toHaveLength(0);
  });

  it("our server needs its URL: a key alone isn't a setup", async () => {
    const { transcriptionSetup } = await load({ TRANSCRIBE_PROVIDER: "nvidia", TRANSCRIBE_API_KEY: "k" });
    expect(transcriptionSetup()).toBeNull();
  });

  it("Together on its own: Parakeet for detect-it and European languages, Whisper for the rest", async () => {
    const { transcribe, transcriptionSetup } = await load({ TRANSCRIBE_PROVIDER: "together", TRANSCRIBE_API_KEY: "tg" });
    expect(transcriptionSetup()).toMatchObject({ model: "nvidia/parakeet-tdt-0.6b-v3", label: "NVIDIA Parakeet on Together AI" });
    const calls = fakeFetch([verbose("a"), verbose("b"), verbose("c")]);
    await transcribe(input);
    await transcribe({ ...input, language: "pl" });
    await transcribe({ ...input, language: "ja" });
    expect(calls.map((c) => c.form.get("model"))).toEqual(["nvidia/parakeet-tdt-0.6b-v3", "nvidia/parakeet-tdt-0.6b-v3", "openai/whisper-large-v3"]);
  });

  it("a model someone chose themselves is used for every language", async () => {
    const { transcribe } = await load({ TRANSCRIBE_PROVIDER: "together", TRANSCRIBE_API_KEY: "tg", TRANSCRIBE_MODEL: "openai/whisper-large-v3" });
    const calls = fakeFetch([verbose("a")]);
    await transcribe({ ...input, language: "ja" });
    expect(calls[0].form.get("model")).toBe("openai/whisper-large-v3");
  });

  it("Groq bills at least 10 seconds a request", async () => {
    const { transcribe } = await load({ TRANSCRIBE_PROVIDER: "groq", TRANSCRIBE_API_KEY: "gsk" });
    fakeFetch([() => Response.json({ duration: 2, segments: [{ start: 0, end: 2, text: "Short." }] })]);
    const out = await transcribe(input);
    expect(out.costMicros).toBe(Math.round(10 * (0.04 / 3600) * 1e6));
    expect(out.prompted).toBe(true);
  });
});
