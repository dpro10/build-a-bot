import { test } from "node:test";
import assert from "node:assert/strict";
import { forSpeech, normalizeForSpeech, numberToWords, ordinalWords, SentenceChunker, speakable, yearWords } from "../src/speech/text.ts";

test("numbers in words", () => {
  assert.equal(numberToWords(0), "zero");
  assert.equal(numberToWords(7), "seven");
  assert.equal(numberToWords(42), "forty-two");
  assert.equal(numberToWords(100), "one hundred");
  assert.equal(numberToWords(1234), "one thousand two hundred thirty-four");
  assert.equal(numberToWords(1_000_005), "one million five");
  assert.equal(numberToWords(-3), "minus three");
});

test("ordinals and years", () => {
  assert.equal(ordinalWords(1), "first");
  assert.equal(ordinalWords(2), "second");
  assert.equal(ordinalWords(3), "third");
  assert.equal(ordinalWords(12), "twelfth");
  assert.equal(ordinalWords(20), "twentieth");
  assert.equal(ordinalWords(22), "twenty-second");
  assert.equal(ordinalWords(31), "thirty-first");
  assert.equal(ordinalWords(100), "one hundredth");
  assert.equal(yearWords(1999), "nineteen ninety-nine");
  assert.equal(yearWords(2005), "two thousand five");
  assert.equal(yearWords(2026), "twenty twenty-six");
  assert.equal(yearWords(1900), "nineteen hundred");
  assert.equal(yearWords(1905), "nineteen oh five");
});

test("money, percentages and temperatures are said the way people say them", () => {
  assert.equal(normalizeForSpeech("It's $12.50."), "It's twelve dollars and fifty cents.");
  assert.equal(normalizeForSpeech("That's $1,200 total"), "That's one thousand two hundred dollars total");
  assert.equal(normalizeForSpeech("only $0.99"), "only ninety-nine cents");
  assert.equal(normalizeForSpeech("$1 even"), "one dollar even");
  assert.equal(normalizeForSpeech("raised $2.5M"), "raised two point five million dollars");
  assert.equal(normalizeForSpeech("€20 or £5"), "twenty euros or five pounds");
  assert.equal(normalizeForSpeech("up 20% today"), "up twenty percent today");
  assert.equal(normalizeForSpeech("3.5% APR"), "three point five percent APR");
  assert.equal(normalizeForSpeech("It's 72°F out"), "It's seventy-two degrees Fahrenheit out");
});

test("times and dates", () => {
  assert.equal(normalizeForSpeech("at 3:30 PM"), "at three thirty P M");
  assert.equal(normalizeForSpeech("at 10:00"), "at ten o'clock");
  assert.equal(normalizeForSpeech("at 9:05am"), "at nine oh five A M");
  assert.equal(normalizeForSpeech("from 3pm to 5 p.m."), "from three P M to five P M");
  assert.equal(normalizeForSpeech("on 2026-10-16"), "on October sixteenth, twenty twenty-six");
  assert.equal(normalizeForSpeech("on Oct 16"), "on October sixteenth");
  assert.equal(normalizeForSpeech("by March 3rd, 2027"), "by March third, twenty twenty-seven");
  assert.equal(normalizeForSpeech("the 21st"), "the twenty-first");
});

test("phone numbers digit by digit, other numbers as numbers", () => {
  assert.equal(normalizeForSpeech("Call (555) 123-4567 now"), "Call five five five, one two three, four five six seven now");
  assert.equal(normalizeForSpeech("+1 415 555 0100"), "four one five, five five five, oh one oh oh");
  assert.equal(normalizeForSpeech("I have 3 meetings and 1,500 emails"), "I have three meetings and one thousand five hundred emails");
  assert.equal(normalizeForSpeech("pi is 3.14"), "pi is three point one four");
  assert.equal(normalizeForSpeech("in 1999 and 2026"), "in nineteen ninety-nine and twenty twenty-six");
  assert.equal(normalizeForSpeech("code 0042"), "code oh oh four two");
  assert.equal(normalizeForSpeech("3-5 days"), "three to five days");
});

test("symbols and abbreviations", () => {
  assert.equal(normalizeForSpeech("Tom & Jerry"), "Tom and Jerry");
  assert.equal(normalizeForSpeech("e.g. lunch"), "for example lunch");
  assert.equal(normalizeForSpeech("Mr. Smith and Dr. Lee"), "Mister Smith and Doctor Lee");
  assert.equal(normalizeForSpeech("about 5 mins away"), "about five minutes away");
  assert.equal(normalizeForSpeech("ticket #42"), "ticket number forty-two");
  assert.equal(normalizeForSpeech("a {weird} <tag> [x]"), "a weird tag x");
});

test("chat formatting comes out", () => {
  assert.equal(speakable("**Sure!** Here's _one_ idea."), "Sure! Here's one idea.");
  assert.equal(speakable("See [the doc](https://x.y/z) or https://example.com/a?b=c"), "See the doc or the link");
  assert.equal(speakable("## Plan\n- Call Ana\n- Book the room"), "Plan, Call Ana, Book the room");
  assert.equal(speakable("Done ✅ 🎉"), "Done");
  assert.equal(speakable("Use `npm test` here"), "Use npm test here");
  assert.equal(speakable("Run:\n```\nrm -rf x\n```\nthen wait"), "Run: then wait");
});

test("forSpeech does both", () => {
  assert.equal(forSpeech("**Total:** $40 at 2:15 PM"), "Total: forty dollars at two fifteen P M");
});

function chunkAll(deltas: string[], chunker = new SentenceChunker()): string[] {
  const out: string[] = [];
  for (const d of deltas) out.push(...chunker.push(d));
  out.push(...chunker.flush());
  return out;
}

test("streams split into sentences as they arrive", () => {
  const chunker = new SentenceChunker();
  assert.deepEqual(chunker.push("Sure thing. I'll "), ["Sure thing."]);
  assert.deepEqual(chunker.push("check your calendar"), []);
  assert.deepEqual(chunker.push("! Anything else?"), ["I'll check your calendar!"]);
  assert.deepEqual(chunker.flush(), ["Anything else?"]);
});

test("the first piece may end at a clause; later ones wait for the sentence", () => {
  const out = chunkAll(["Okay, so you have three meetings tomorrow, ", "the first at nine, then lunch, then a review."]);
  assert.deepEqual(out, ["Okay, so you have three meetings tomorrow,", "the first at nine, then lunch, then a review."]);
});

test("abbreviations, decimals and initials don't end a sentence", () => {
  assert.deepEqual(chunkAll(["Ask Dr. Lee at 3.30 about the U.S. trip. Then call J. K. Rowling."]), [
    "Ask Dr. Lee at 3.30 about the U.S. trip.",
    "Then call J. K. Rowling.",
  ]);
});

test("a run-on sentence is cut before it gets too long", () => {
  const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
  const out = chunkAll([words], new SentenceChunker({ maxWords: 20 }));
  assert.ok(out.length >= 2);
  for (const piece of out) assert.ok(piece.split(" ").length <= 30);
  assert.equal(out.join(" "), words);
});

test("pieces with nothing to say are dropped", () => {
  assert.deepEqual(chunkAll(["... ", "\n", "Hi."]), ["Hi."]);
});
