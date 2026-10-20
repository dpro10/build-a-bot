/**
 * Sign-in links on a real (not demo) server: email that isn't set up and an email that
 * couldn't be sent are different problems with different messages, and the provider's
 * error is logged on the server (status and body, never the API key).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.RESEND_API_KEY = "re_test_do_not_log_me_123";
delete process.env.DATABASE_URL;
delete process.env.AGENTMAIL_API_KEY;

// The route marks the browser that asks for a link with a cookie.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => null,
}));

const { resetDbForTests } = await import("@/lib/db");
const { config } = await import("@/lib/env");
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

describe("sign-in emails", () => {
  it("sends the link (and never shows it on screen)", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ id: "em_1" }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await ask("sam@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, demoLink: null });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a send the provider refused says to try again, and the reason is logged without the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ name: "validation_error", message: "The build-a-bot.site domain is not verified." }, { status: 403 })),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ask("pat@example.com");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("email_send_failed");
    expect(body.error).toBe("We couldn't send the email just now. Try again in a minute.");
    expect(body.demoLink).toBeUndefined();

    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("Resend 403");
    expect(logged).toContain("domain is not verified");
    expect(logged).not.toContain("re_test_do_not_log_me_123");
  });

  it("a provider that can't be reached is a send failure too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ask("lee@example.com");
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("email_send_failed");
    expect(log.mock.calls.flat().join(" ")).toContain("fetch failed");
  });

  it("no email provider at all is the operator's problem, and says so", async () => {
    const key = config.email.resendKey;
    config.email.resendKey = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await ask("kim@example.com");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("email_not_configured");
      expect(body.error).toBe("Sign-in by email isn't set up on this server yet.");
      expect(body.demoLink).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      config.email.resendKey = key;
    }
  });
});
