/**
 * The bot tabs that moved (2026-10-24): Library → Memory › Files, Channels → Apps & channels,
 * Activity → Settings › Activity. Old links land on the new tab with their query string.
 */
import { describe, expect, it } from "vitest";
import { movedTabHref } from "@/lib/bots/tab-links";

describe("old bot tab links", () => {
  it("land on the tab that holds them now", () => {
    expect(movedTabHref("bot_1", "library", {})).toBe("/app/bots/bot_1/memory?tab=files");
    expect(movedTabHref("bot_1", "channels", {})).toBe("/app/bots/bot_1/tools?tab=channels");
    expect(movedTabHref("bot_1", "activity", {})).toBe("/app/bots/bot_1/settings?tab=activity");
  });

  it("keep what came with them: Slack's return, the activity filter, the deliveries view", () => {
    expect(movedTabHref("bot_1", "channels", { slack: "added", moved: "Pip" })).toBe("/app/bots/bot_1/tools?tab=channels&slack=added&moved=Pip");
    expect(movedTabHref("bot_1", "activity", { filter: "messages", tab: "deliveries" })).toBe("/app/bots/bot_1/settings?tab=activity&filter=messages&view=deliveries");
    // A stray ?tab= can't send them somewhere else.
    expect(movedTabHref("bot_1", "library", { tab: "people" })).toBe("/app/bots/bot_1/memory?tab=files");
  });
});
