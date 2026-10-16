/**
 * A site with no speech-to-text, even in demo mode (as build-a-bot.site is today): nothing turns a
 * recording into made-up words. Diego (2026-10-16), after the web try-it typed a sample sentence
 * when he said "test, test, test": "this isnt good".
 *
 * - A recording sent to voice typing is refused (the desktop app says why instead), and the desktop
 *   session tells the app the server doesn't hear recordings.
 * - What the computer heard itself (NVIDIA Parakeet in the desktop app) is cleaned up as usual.
 * - Meeting notes aren't offered: a recording can't be transcribed, so there's no scripted meeting.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
// As on a deployed site (a production build): no scripted speech.
process.env.DEMO_SPEECH = "0";
delete process.env.DATABASE_URL;
for (const key of ["TOKEN_FACTORY_API_KEY", "TRANSCRIBE_API_KEY", "TRANSCRIBE_FALLBACK_API_KEY"]) delete process.env[key];

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { sha256 } = await import("@/lib/crypto");
const { speechToTextAvailable } = await import("@/lib/dictation");
const { TranscriptionError, transcribe, transcriptionAvailable } = await import("@/lib/transcribe");
const dictateRoute = await import("@/app/api/voice/dictate/route");
const sessionRoute = await import("@/app/api/desktop/session/route");

const TOKEN = "bab_dev_no_speech_token";
const device = { authorization: `Bearer ${TOKEN}` };

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  const [owner] = await db.insert(schema.users).values({ id: "usr_diego", email: "diego@example.com", name: "Diego", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  await db.insert(schema.bridgeDevices).values({ id: "dev_win", ownerId: owner.id, name: "Diego's PC", tokenHash: sha256(TOKEN), platform: "desktop-win32-x64", clis: {} });
});

afterAll(async () => {
  await resetDbForTests();
});

describe("no speech-to-text, in demo mode", () => {
  it("doesn't turn a recording into sample words", async () => {
    expect(speechToTextAvailable()).toBe(false);
    const res = await dictateRoute.POST(new Request("http://localhost/api/voice/dictate?durationMs=3000&speechMs=2500", { method: "POST", headers: { ...device, "content-type": "audio/webm" }, body: new Uint8Array(4000).fill(1) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable" });
  });

  it("cleans up what the desktop app heard on the computer", async () => {
    const res = await dictateRoute.POST(
      new Request("http://localhost/api/voice/dictate?durationMs=2500&speechMs=2000", { method: "POST", headers: { ...device, "content-type": "application/json" }, body: JSON.stringify({ heard: "Test, test, test." }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "text", text: "Test, test, test.", simulated: false });
  });

  it("tells the desktop app the server doesn't hear recordings, and doesn't offer meeting notes", async () => {
    const body = await (await sessionRoute.GET(new Request("http://localhost/api/desktop/session", { headers: device }))).json();
    expect(body.voice).toMatchObject({ available: false, simulated: false, local: true });
    expect(body.meetings.available).toBe(false);
    expect(transcriptionAvailable()).toBe(false);
    await expect(transcribe({ audio: new ArrayBuffer(4000), mime: "audio/webm", durationMs: 6000, track: "mic", chunk: 0 })).rejects.toBeInstanceOf(TranscriptionError);
  });
});
