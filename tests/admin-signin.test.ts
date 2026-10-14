/**
 * On a demo server the sign-in link is shown on screen, so the operator's own (admin)
 * emails also need the admin code: nobody else can sign in as them and open /admin.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
process.env.ADMIN_EMAILS = "boss@example.com";
process.env.ADMIN_SIGNIN_CODE = "correct horse battery staple";
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;
delete process.env.AGENTMAIL_API_KEY;

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => null,
}));

const { resetDbForTests } = await import("@/lib/db");
const magic = await import("@/app/api/auth/magic/route");

const ask = (body: Record<string, unknown>) =>
  magic.POST(new Request("http://localhost/api/auth/magic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeAll(async () => {
  await resetDbForTests();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("admin sign-in on a demo server", () => {
  it("asks for the admin code, refuses a wrong one, and only then shows the link", async () => {
    const none = await ask({ email: "Boss@Example.com" });
    expect(none.status).toBe(403);
    expect((await none.json()).needsAdminCode).toBe(true);

    const wrong = await ask({ email: "boss@example.com", adminCode: "hunter2" });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).demoLink).toBeUndefined();

    const right = await ask({ email: "boss@example.com", adminCode: "correct horse battery staple" });
    expect(right.status).toBe(200);
    expect((await right.json()).demoLink).toMatch(/\/auth\/verify\?token=/);
  });

  it("everyone else still gets the on-screen link", async () => {
    const res = await ask({ email: "someone@example.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).demoLink).toMatch(/\/auth\/verify\?token=/);
  });
});
