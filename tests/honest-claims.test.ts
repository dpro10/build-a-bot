/**
 * What the site says follows what this deployment does: whether audio can leave the user's
 * computer (and who hears it if so), which channels the site's description names, and what a
 * minute of a call is charged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const KEYS = /^(TRANSCRIBE_|TWILIO_|VOICE_SERVER_|DISCORD_|DEMO_)/;
const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => KEYS.test(k)));

/** Out of demo mode, with only these set; the next import reads them afresh. */
function setEnv(env: Record<string, string>) {
  for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
  Object.assign(process.env, { DEMO_MODE: "0", DEMO_SPEECH: "0" }, env);
  vi.resetModules();
}

afterEach(() => {
  for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
  Object.assign(process.env, saved);
  vi.resetModules();
});

const TWILIO = { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "token", TWILIO_PHONE_NUMBER: "+15125550100" };
const VOICE_SERVER = { VOICE_SERVER_URL: "https://voice.example.test", VOICE_SERVER_SECRET: "s".repeat(32) };

describe("the audio of voice typing and meeting notes", () => {
  it("never leaves the computer when this server can't turn recordings into text, and no speech service is named", async () => {
    setEnv({});
    const t = await import("@/lib/transcribe");
    expect(t.audioStaysOnComputer()).toBe(true);
    expect(t.speechServices()).toEqual([]);
  });

  it("can reach this server when it has speech-to-text: the site stops promising otherwise, and names who hears it", async () => {
    setEnv({
      TRANSCRIBE_PROVIDER: "nvidia",
      TRANSCRIBE_BASE_URL: "https://speech.example.test/v1",
      TRANSCRIBE_API_KEY: "speech_key",
      TRANSCRIBE_FALLBACK_PROVIDER: "together",
      TRANSCRIBE_FALLBACK_API_KEY: "tg_key",
    });
    const t = await import("@/lib/transcribe");
    expect(t.audioStaysOnComputer()).toBe(false);
    expect(t.speechServices()).toEqual(["NVIDIA Parakeet and Nemotron on our speech server (Nebius)", "NVIDIA Parakeet on Together AI"]);
  });

  it("counts scripted speech (a demo or a test run) as hearing audio too", async () => {
    setEnv({ DEMO_MODE: "1", DEMO_SPEECH: "1" });
    const t = await import("@/lib/transcribe");
    expect(t.audioStaysOnComputer()).toBe(false);
  });
});

describe("the site's description", () => {
  it("names what thinks, and only the channels that work here", async () => {
    setEnv({});
    const { siteDescription } = await import("@/lib/site-description");
    const d = siteDescription();
    expect(d).toContain("NVIDIA Nemotron and other open models on Nebius");
    expect(d).toMatch(/talk to it on the web, Telegram or Slack\.$/);
    expect(d).not.toMatch(/Discord|call|text it|coming soon/);
  });

  it("adds Discord and calling once they're set up", async () => {
    setEnv({ DISCORD_APPLICATION_ID: "123", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_BOT_TOKEN: "bot", ...TWILIO });
    const { siteDescription } = await import("@/lib/site-description");
    expect(siteDescription()).toMatch(/talk to it on the web, Telegram, Discord or Slack, or call it\.$/);
  });
});

describe("a minute of a call, as it's charged", () => {
  it("on Twilio's own speech: the line plus its speech, $0.05", async () => {
    setEnv({ ...TWILIO });
    const { callMinuteMicros, callsOnVoiceServer } = await import("@/lib/billing/call-rate");
    expect(callsOnVoiceServer()).toBe(false);
    expect(callMinuteMicros()).toBe(50_000);
  });

  it("a voice server alone isn't enough: calls reach it only over media streams", async () => {
    setEnv({ ...TWILIO, ...VOICE_SERVER });
    const { callMinuteMicros } = await import("@/lib/billing/call-rate");
    expect(callMinuteMicros()).toBe(50_000);
  });

  it("handed to the voice server: just the line and its audio stream", async () => {
    setEnv({ ...TWILIO, ...VOICE_SERVER, TWILIO_MEDIA_STREAMS: "1" });
    const { callMinuteMicros, callsOnVoiceServer } = await import("@/lib/billing/call-rate");
    const { UNIT_PRICES } = await import("@/lib/billing/prices");
    expect(callsOnVoiceServer()).toBe(true);
    expect(callMinuteMicros()).toBe(UNIT_PRICES.callMinuteStreamIn);
  });
});
