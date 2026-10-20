/**
 * Learning from a fix made where the words were typed, across the desktop app and the server: the
 * desktop app (desktop/src/main/voice/learn.mjs) decides what a fix teaches with the server's own
 * sound-alike key, and what it learns, saved as a dictionary word, makes the server type the fix
 * the next time speech-to-text writes the same thing.
 */
import { describe, expect, it } from "vitest";
import { applyDictionary, phoneticKey } from "@/lib/dictation/text";

type Learned = { text: string; heard: string[] };
type Learn = {
  phoneticKey(word: string): string;
  learnFromFix(before: string, after: string, known?: string[]): Learned[];
};

// The desktop app's module (plain JavaScript, outside this project's TypeScript).
const learnUrl = new URL("../desktop/src/main/voice/learn.mjs", import.meta.url).href;
const learn = (await import(/* @vite-ignore */ learnUrl)) as Learn;

describe("learning from a fix", () => {
  it("the desktop app's sound-alike key is the server's", () => {
    const words = ["Prozzi", "pro zee", "Kubernetes", "cooper nettie's", "GitHub", "git hub", "Nemotron", "nemo tron", "Philippe", "Knight", "Thompson", "Xochitl", "Cécile", "O'Brien", "Jon", "John", "Wright", "ghost", "Quinn", "Ciara", "", "42"];
    for (const w of words) expect(learn.phoneticKey(w), w).toBe(phoneticKey(w));
  });

  it("what a fix teaches makes the next dictation come out fixed", () => {
    const cases: Array<[string, string]> = [
      ["Meet pro zee at the lab.", "Meet Prozzi at the lab."],
      ["Deploy it on cooper nettie's tonight.", "Deploy it on Kubernetes tonight."],
      ["Push it to github.", "Push it to GitHub."],
      ["Welcome to build a bot.", "Welcome to Build-a-bot."],
      ["Ask Jon about it.", "Ask John about it."],
    ];
    for (const [heard, fixed] of cases) {
      const words = learn.learnFromFix(heard, fixed);
      expect(words.length, fixed).toBeGreaterThan(0);
      // The next time speech-to-text writes it that way, it's typed the way it was fixed.
      expect(applyDictionary(heard, words)).toBe(fixed);
      expect(applyDictionary(`Later: ${heard.charAt(0).toLowerCase()}${heard.slice(1)}`, words)).toBe(`Later: ${fixed.charAt(0).toLowerCase()}${fixed.slice(1)}`);
    }
  });

  it("an edit teaches nothing, so the next dictation is left alone", () => {
    for (const [heard, edited] of [
      ["Call Mark tomorrow.", "Call Sarah tomorrow."],
      ["See you Tuesday.", "See you Thursday."],
      ["Ask Prozzi about it.", "Ask Prozzi's team about it."],
    ]) {
      expect(learn.learnFromFix(heard, edited), edited).toEqual([]);
    }
  });
});
