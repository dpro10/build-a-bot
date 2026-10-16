/**
 * The builder shows what the server will really do: built-ins that are coming soon can't be
 * picked, the bot only counts the apps that will connect, every included model can be picked
 * (there are no plans; a saved draft drops only a model we no longer serve), the review step says
 * what it will cost, and model sizes read the same as in Settings.
 */
import { describe, expect, it } from "vitest";
import { speech } from "@/components/builder/BotPreview";
import { DEFAULT_MODEL, countedApps, initialState, withDraft, type BuilderContext } from "@/components/builder/state";
import { adjustmentsFor, costLine } from "@/components/builder/steps/ReviewStep";
import { isAvailable, suggestedFor } from "@/components/catalog/connector-meta";
import { getConnector } from "@/lib/connectors";
import { contextLabel } from "@/lib/models/catalog";
import { findFeatured } from "@/lib/recipes";

const SUPER = "nvidia/nemotron-3-super-120b-a12b"; // a bigger model

/** The live site before any keys: nothing set up. */
const ctx = (over: Partial<BuilderContext> = {}): BuilderContext => ({ demo: false, live: {}, comingSoon: [], ownerEmail: null, ...over });
const fresh = (over: Partial<BuilderContext> = {}) => initialState(null, ctx(over));

describe("the builder", () => {
  it("the bot counts the apps that will connect, like the counter under it", () => {
    // Research and Errands bring 6 built-in tools; none of them is an app.
    const tools = { ...fresh(), connectors: ["web_search", "web_reader", "wikipedia", "news", "notes", "weather"] };
    expect(countedApps(tools.connectors, tools.customMcp)).toBe(0);
    expect(speech("apps", tools, 3)).toBe("Tools packed! Which apps do you use?");

    const five = { ...tools, connectors: [...tools.connectors, "gmail", "github", "notion", "spotify", "todoist"] };
    expect(countedApps(five.connectors, five.customMcp)).toBe(5);
    expect(speech("apps", five, 3)).toBe("3 apps! I'll put them to work."); // capped by the limit it's given
    expect(speech("apps", five)).toBe("5 apps! I'll put them to work."); // demo mode connects them all
    expect(speech("apps", { ...fresh(), customMcp: [{ url: "https://mcp.example.com/mcp" }] }, 3)).toBe("1 app! I'll put it to work.");
    expect(speech("apps", fresh(), 3)).toBe("Which apps can I help with?");
  });

  it("a built-in that's coming soon can't be picked or suggested", () => {
    const soon = new Set(["browser"]);
    const browser = getConnector("browser")!;
    expect(isAvailable(browser)).toBe(true);
    expect(isAvailable(browser, soon)).toBe(false);
    expect(suggestedFor(["errands"], 500).map((d) => d.id)).toContain("browser");
    expect(suggestedFor(["errands"], 500, soon).map((d) => d.id)).not.toContain("browser");
  });

  it("a recipe and a saved draft leave coming-soon built-ins out", () => {
    const recipe = findFeatured("meeting-buddy")!;
    expect(initialState(recipe, ctx()).connectors).toContain("meetings");
    expect(initialState(recipe, ctx({ comingSoon: ["meetings"] })).connectors).not.toContain("meetings");
    const draft = { ...fresh(), connectors: ["browser", "notes"] };
    expect(withDraft(fresh(), draft, ctx({ comingSoon: ["browser"] })).connectors).toEqual(["notes"]);
  });

  it("any included model can be picked; a saved draft drops only a model we no longer serve", () => {
    const draft = { ...fresh(), brain: { kind: "included" as const, model: SUPER, effort: "low" as const } };
    expect(withDraft(fresh(), draft, ctx()).brain).toMatchObject({ model: SUPER });
    const gone = { ...fresh(), brain: { kind: "included" as const, model: "someone/retired-model", effort: "low" as const } };
    expect(withDraft(fresh(), gone, ctx()).brain).toMatchObject({ model: DEFAULT_MODEL });
  });

  it("the review step says what the bot will cost, at cost", () => {
    // The default model: about $0.00042 a message (5,000 tokens in at $0.06/M, 500 out at $0.24/M).
    expect(costLine(fresh())).toBe("About $0.00042 a message on Nemotron 3.5 Lightning, paid from your credit at cost.");
    const searching = { ...fresh(), connectors: ["web_search"], channels: ["sms" as const] };
    expect(costLine(searching)).toBe(
      "About $0.00042 a message on Nemotron 3.5 Lightning, paid from your credit at cost. Each web lookup is $0.008. Texts and calls are paid from credit too.",
    );
    const ownKey = { ...fresh(), brain: { kind: "byok" as const, provider: "anthropic" as const, model: "claude-sonnet-5-5", baseUrl: "" } };
    expect(costLine(ownKey)).toBe("Free here: Anthropic (Claude) bills you for the thinking.");
    const sub = { ...fresh(), brain: { kind: "subscription" as const, subscription: "chatgpt" as const, model: "default", whenOffline: "wait" as const } };
    expect(costLine(sub)).toBe("Free here: it thinks on your ChatGPT subscription, on your computer.");
    // Only the fair-use limit on apps is ever adjusted, and never in demo mode.
    const many = { ...fresh(), customMcp: Array.from({ length: 201 }, (_, i) => ({ url: `https://mcp.example.com/${i}` })) };
    expect(adjustmentsFor(many, false)).toEqual(["A bot can connect up to 200 apps. The first 200 are added now."]);
    expect(adjustmentsFor(many, true)).toEqual([]);
    expect(adjustmentsFor(fresh(), false)).toEqual([]);
  });

  it("context sizes read the same in the builder and in Settings", () => {
    expect(contextLabel(131_072)).toBe("128K");
    expect(contextLabel(262_144)).toBe("256K");
    expect(contextLabel(1_024_000)).toBe("1M");
    expect(contextLabel(1_048_576)).toBe("1M");
    expect(contextLabel(undefined)).toBeNull();
  });
});
