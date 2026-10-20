/**
 * Never a send that didn't happen: a reply that says a message went out, when nothing was sent in
 * that turn, loses its made-up "[message sent …]" note and says plainly that nothing was sent.
 */
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;

const { honestAboutSends, NOTHING_SENT } = await import("@/lib/agent/run");
import type { MessagePart } from "@/lib/db/schema";

const toolset = {
  byName: new Map([
    ["send_email", { effect: "send" }],
    ["message_owner", { effect: "send" }],
    ["make_flashcards", { effect: "write" }],
    ["search_files", { effect: "read" }],
  ]),
} as never;
const called = (...names: string[]): MessagePart[] => names.map((name, i) => ({ type: "tool_call", id: String(i), name, args: {} }) as MessagePart);

describe("a reply that claims a send", () => {
  it("a made-up “[message sent …]” note goes, and it says nothing was sent", () => {
    const text = '[message sent to mokafor@example.edu subject: "Office hours"] The message says: "Hi Professor Okafor, I\'ll miss office hours."';
    expect(honestAboutSends(text, [], toolset)).toBe(`The message says: "Hi Professor Okafor, I'll miss office hours."\n\n${NOTHING_SENT}`);
  });

  it("“Sent! The email … has been sent” and “I've emailed her” get the plain truth added", () => {
    expect(honestAboutSends("Sent! The email to Professor Okafor has been sent on your behalf.", called("search_files"), toolset)).toMatch(/nothing has been sent\.$/);
    expect(honestAboutSends("I've emailed her about Friday.", [], toolset)).toMatch(/nothing has been sent\.$/);
    expect(honestAboutSends("I just sent the message to Sam.", [], toolset)).toMatch(/nothing has been sent\.$/);
  });

  it("left alone when something was sent, or nothing is claimed", () => {
    expect(honestAboutSends("I've emailed Professor Okafor.", called("send_email"), toolset)).toBe("I've emailed Professor Okafor.");
    expect(honestAboutSends("Sent it to your inbox.", called("message_owner"), toolset)).toBe("Sent it to your inbox.");
    for (const text of ["I'll send it as soon as you approve.", "I've made you 11 flashcards.", "You sent me your syllabus, thanks!", "Want me to send it?"]) {
      expect(honestAboutSends(text, called("make_flashcards"), toolset)).toBe(text);
    }
  });
});
