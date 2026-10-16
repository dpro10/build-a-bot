/**
 * A demo server that has email set up (the live site, for now) sends sign-in links like a real
 * one: the link only ever goes to the inbox. When a send fails it says so, and never shows the link
 * on screen, or anyone could sign in as anyone (sends can be made to fail by using up the quota).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
process.env.RESEND_API_KEY = "re_test_demo_server_key_456";
process.env.ADMIN_EMAILS = "boss@example.com";
delete process.env.ADMIN_SIGNIN_CODE;
delete process.env.DATABASE_URL;
delete process.env.AGENTMAIL_API_KEY;

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => null,
}));

const { resetDbForTests } = await import("@/lib/db");
const magic = await import("@/app/api/auth/magic/route");

const ask = (email: string) =>
  magic.POST(new Request("http://localhost/api/auth/magic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }));

beforeAll(async () => {
  await resetDbForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("sign-in links on a demo server with email set up", () => {
  it("sends the link to the inbox, not the screen", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ id: "em_1" }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await ask("sam@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, demoLink: null });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a send that fails (the day's quota used up) says so, and never shows the link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }, { status: 429 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ask("victim@example.com");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ code: "email_send_failed", error: "We couldn't send the email just now. Try again in a minute." });
    expect(body.demoLink).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("/auth/verify");
  });

  it("an email provider that can't be reached doesn't show the link either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ask("lee@example.com");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("/auth/verify");
  });

  it("the operator's own email gets its link by email too (no admin code needed, nothing on screen)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "em_2" })));
    const ok = await ask("boss@example.com");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sent: true, demoLink: null });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await ask("boss@example.com");
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("/auth/verify");
  });
});
