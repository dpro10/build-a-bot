/**
 * Voice typing's text rules, with no AI: the cleanup that always runs (and is the fallback),
 * the owner's dictionary and snippets, "Hey Otto, …", and the checks on the AI's cleanup.
 */
import { describe, expect, it } from "vitest";
import {
  acceptPolish,
  applyDictionary,
  countWords,
  isDistinctive,
  isPhantom,
  isPromptEcho,
  matchCommand,
  phoneticKey,
  plainText,
  properNouns,
  protectSnippets,
  restoreSnippets,
  tidyTranscript,
  uniqueWords,
  whisperPrompt,
} from "@/lib/dictation/text";

describe("the cleanup that needs no AI", () => {
  it("takes fillers out and keeps the sentence's punctuation and capitals", () => {
    expect(tidyTranscript("Um, so I was thinking we could go.")).toBe("So I was thinking we could go.");
    expect(tidyTranscript("I was, um, thinking about it.")).toBe("I was thinking about it.");
    expect(tidyTranscript("See you tomorrow, uh.")).toBe("See you tomorrow.");
    expect(tidyTranscript("What do you think, um?")).toBe("What do you think?");
    expect(tidyTranscript("Okay. Uh, let's start.")).toBe("Okay. Let's start.");
  });

  it("leaves words that only look like fillers", () => {
    expect(tidyTranscript("I went to the ER, uh, yesterday.")).toBe("I went to the ER yesterday.");
    expect(tidyTranscript("Hmm, I like it, so let's do it.")).toBe("Hmm, I like it, so let's do it.");
  });

  it("collapses stutters, but not doubled words that can be right", () => {
    expect(tidyTranscript("I I think the the plan is to to ship.")).toBe("I think the plan is to ship.");
    expect(tidyTranscript("I know that that is true and he had had enough.")).toBe("I know that that is true and he had had enough.");
  });

  it("turns spoken line breaks into real ones, but not the words in a sentence", () => {
    expect(tidyTranscript("Hi Sam. New paragraph. I wanted to ask about the budget.")).toBe("Hi Sam.\n\nI wanted to ask about the budget.");
    expect(tidyTranscript("Thanks. New line. Diego")).toBe("Thanks.\nDiego");
    expect(tidyTranscript("first line. new line. second line. new line. third")).toBe("First line.\nSecond line.\nThird");
    expect(tidyTranscript("We launched a new line of shoes.")).toBe("We launched a new line of shoes.");
    expect(tidyTranscript("Add a new paragraph about pricing.")).toBe("Add a new paragraph about pricing.");
  });

  it("drops the sentence before \"scratch that\"", () => {
    expect(tidyTranscript("I'll be there at 5. Scratch that. I'll be there at 6.")).toBe("I'll be there at 6.");
    expect(tidyTranscript("It costs 3.5 dollars. Scratch that. It's free.")).toBe("It's free.");
    expect(tidyTranscript("Visit site.com. Scratch that. Visit other.com.")).toBe("Visit other.com.");
    expect(tidyTranscript("Scratch that.")).toBe("");
  });

  it("is a no-op on clean text and empty input", () => {
    const clean = "Let's meet at 3 tomorrow and bring the slides.";
    expect(tidyTranscript(clean)).toBe(clean);
    expect(tidyTranscript("   ")).toBe("");
  });
});

describe("the personal dictionary", () => {
  const words = [
    { text: "Prozzi", heard: ["pro zee", "prozzy"] },
    { text: "GitHub", heard: [] },
    { text: "Will", heard: [] },
    { text: "Build-a-bot", heard: ["build a bot"] },
  ];

  it("spells the owner's words their way", () => {
    expect(applyDictionary("I talked to pro zee about github and the build a bot launch.", words)).toBe("I talked to Prozzi about GitHub and the Build-a-bot launch.");
    expect(applyDictionary("Prozzy said hi.", words)).toBe("Prozzi said hi.");
  });

  it("doesn't capitalize everyday words that are also names", () => {
    expect(applyDictionary("I will call Will tomorrow.", words)).toBe("I will call Will tomorrow.");
    expect(isDistinctive("Will")).toBe(false);
    expect(["GitHub", "iPhone", "TAMU", "Build-a-bot", "New York", "K8s"].every(isDistinctive)).toBe(true);
  });

  it("matches whole words only", () => {
    expect(applyDictionary("The github-like site and agithub.", [{ text: "GitHub", heard: [] }])).toBe("The GitHub-like site and agithub.");
  });

  it("types a snippet when its phrase is said, and the AI can't reword it", () => {
    const snippets = [{ text: "https://cal.com/diego", heard: ["my booking link"] }];
    const p = protectSnippets("Book a time here: my booking link. Thanks!", snippets);
    expect(p).toEqual({ text: "Book a time here: ⟦1⟧. Thanks!", slots: ["https://cal.com/diego"] });
    expect(restoreSnippets(p.text, p.slots)).toBe("Book a time here: https://cal.com/diego. Thanks!");
    // Said on its own, it's typed exactly as written.
    const alone = protectSnippets("My address.", [{ text: "1 Main St\nAustin, TX", heard: ["my address"] }]);
    expect(restoreSnippets(alone.text, alone.slots)).toBe("1 Main St\nAustin, TX");
    // A marker the AI lost or doubled means its answer isn't used.
    expect(restoreSnippets("Book a time here. Thanks!", p.slots)).toBeNull();
    expect(restoreSnippets("⟦1⟧ ⟦1⟧", p.slots)).toBeNull();
  });

  it("learns names from what the bots remember", () => {
    const nouns = properNouns(["Diego's sister is Ana; her birthday is May 3", "Diego lives in Austin and works at Texas A&M", "Ana loves The Beatles"]);
    expect(nouns.slice(0, 3)).toEqual(["Diego", "Ana", "Austin"]);
    expect(nouns).not.toContain("May");
    expect(nouns).not.toContain("The");
    // A word also used in lowercase is an everyday word.
    expect(properNouns(["Rose works at the bank", "She grew a rose"])).toEqual([]);
  });

  it("builds a short speech-to-text prompt from them", () => {
    expect(whisperPrompt(uniqueWords(["Prozzi", "Otto", "prozzi", "Ana"]))).toBe("Prozzi, Otto, Ana.");
    expect(whisperPrompt([])).toBeUndefined();
    const long = whisperPrompt(Array.from({ length: 200 }, (_, i) => `Name${i}`))!;
    expect(long.length).toBeLessThanOrEqual(401);
  });

  it("knows speech-to-text's mistakes on silence", () => {
    expect(isPromptEcho("Prozzi, Otto.", "Prozzi, Otto, Ana.")).toBe(true);
    expect(isPromptEcho("Call Otto later.", "Prozzi, Otto, Ana.")).toBe(false);
    expect(isPromptEcho("Otto.", "Prozzi, Otto, Ana.")).toBe(false);
    expect(isPhantom("Thank you.")).toBe(true);
    expect(isPhantom("Thank you for the slides.")).toBe(false);
  });
});

describe("\"Hey Otto, …\"", () => {
  const bots = [
    { id: "b1", name: "Otto" },
    { id: "b2", name: "Blip" },
    { id: "b3", name: "Otto Two" },
  ];

  it("is a request for the bot when it starts the dictation", () => {
    expect(matchCommand("Hey Otto, remind me to call Mom at 5.", bots)).toEqual({ bot: bots[0], command: "Remind me to call Mom at 5." });
    expect(matchCommand("Hey, Otto. What's on my calendar?", bots)?.command).toBe("What's on my calendar?");
    expect(matchCommand("Okay Blip, add milk to my list", bots)).toEqual({ bot: bots[1], command: "Add milk to my list" });
    expect(matchCommand("Hi Otto Two, what's up?", bots)?.bot.id).toBe("b3");
    expect(matchCommand("Hey Otto.", bots)).toEqual({ bot: bots[0], command: "" });
  });

  it("hears the name even when speech-to-text spells it like a word", () => {
    expect(matchCommand("Hey Auto, what's the weather?", bots)?.bot.id).toBe("b1");
    expect(phoneticKey("Saige")).toBe(phoneticKey("Sage"));
    expect(phoneticKey("Kai")).toBe(phoneticKey("Ky"));
    expect(phoneticKey("Otto")).not.toBe(phoneticKey("Otter"));
  });

  it("isn't triggered by the name anywhere else", () => {
    expect(matchCommand("I told Otto to wait.", bots)).toBeNull();
    expect(matchCommand("Hey team, Otto is here.", bots)).toBeNull();
    expect(matchCommand("Otto, remind me.", bots)).toBeNull();
    expect(matchCommand("Hey", bots)).toBeNull();
  });
});

describe("checking the AI's cleanup", () => {
  it("uses a cleanup that still says what they said", () => {
    expect(acceptPolish("Um can you uh write me a poem about the ocean", "Can you write me a poem about the ocean?")).toBe("Can you write me a poem about the ocean?");
    expect(acceptPolish("let's meet at two no wait three tomorrow and bring the slides", "Let's meet at 3 tomorrow and bring the slides.")).toBe("Let's meet at 3 tomorrow and bring the slides.");
    expect(acceptPolish("i talked to pro zee", "I talked to Prozzi.", ["Prozzi"])).toBe("I talked to Prozzi.");
    expect(acceptPolish("sure i can do that tomorrow", "Sure, I can do that tomorrow.")).toBe("Sure, I can do that tomorrow.");
    expect(acceptPolish("hello there", "<dictation>Hello there.</dictation>")).toBe("Hello there.");
  });

  it("refuses an answer instead of a cleanup", () => {
    expect(acceptPolish("can you write me a poem about the ocean", "Sure! Here's a poem about the ocean:\nWaves roll in...")).toBeNull();
    expect(acceptPolish("write me a poem about the ocean", "The ocean wide, the waves that roll, a song of blue that fills the soul.")).toBeNull();
    expect(acceptPolish("what is the capital of france", "The capital of France is Paris.")).toBeNull();
    expect(acceptPolish("hello", "")).toBeNull();
  });

  it("refuses a cleanup that lost a snippet", () => {
    expect(acceptPolish("here is ⟦1⟧ thanks", "Here is ⟦1⟧. Thanks!")).toBe("Here is ⟦1⟧. Thanks!");
    expect(acceptPolish("here is ⟦1⟧ thanks", "Here it is. Thanks!")).toBeNull();
  });
});

describe("small things", () => {
  it("counts words like a word counter, also without spaces", () => {
    expect(countWords("Hello, world! It's 5:30.")).toBe(5);
    expect(countWords("")).toBe(0);
    expect(countWords("こんにちは世界")).toBeGreaterThan(0);
  });

  it("shows bot replies as plain text", () => {
    expect(plainText("**Done!** I set a reminder:\n- Call Mom at *5 PM*\n[Open the chat](https://x.y)")).toBe("Done! I set a reminder:\n• Call Mom at 5 PM\nOpen the chat");
  });
});
