/**
 * The builder shows what the server will really do: built-ins that are coming soon can't be
 * picked, the bot only counts the apps that will connect, models outside the plan aren't picked,
 * and model sizes read the same as in Settings.
 */
import { describe, expect, it } from "vitest";
import { speech } from "@/components/builder/BotPreview";
import { DEFAULT_MODEL, countedApps, initialState, modelLocked, withDraft, type BuilderContext } from "@/components/builder/state";
import { isAvailable, suggestedFor } from "@/components/catalog/connector-meta";
import { getConnector } from "@/lib/connectors";
import { contextLabel } from "@/lib/models/catalog";
import { findFeatured } from "@/lib/recipes";

const SUPER = "nvidia/nemotron-3-super-120b-a12b"; // a Plus model

/** The live site before any keys: Free plan, nothing set up. */
const ctx = (over: Partial<BuilderContext> = {}): BuilderContext => ({ demo: false, live: {}, plan: "free", comingSoon: [], ownerEmail: null, ...over });
const fresh = (over: Partial<BuilderContext> = {}) => initialState(null, ctx(over));

describe("the builder", () => {
  it("the bot counts the apps that will connect, like the counter under it", () => {
    // Research and Errands bring 6 built-in tools; none of them is an app.
    const tools = { ...fresh(), connectors: ["web_search", "web_reader", "wikipedia", "news", "notes", "weather"] };
    expect(countedApps(tools.connectors, tools.customMcp)).toBe(0);
    expect(speech("apps", tools, 3)).toBe("Tools packed! Which apps do you use?");

    const five = { ...tools, connectors: [...tools.connectors, "gmail", "github", "notion", "spotify", "todoist"] };
    expect(countedApps(five.connectors, five.customMcp)).toBe(5);
    expect(speech("apps", five, 3)).toBe("3 apps! I'll put them to work."); // Free connects 3
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

  it("a model outside the plan can't be picked, so a saved draft starts on the default", () => {
    expect(modelLocked(SUPER, "free", false)).toBe(true);
    expect(modelLocked(SUPER, "plus", false)).toBe(false);
    expect(modelLocked(SUPER, "free", true)).toBe(false); // demo mode lets anyone try it
    expect(modelLocked(DEFAULT_MODEL, "free", false)).toBe(false);
    const draft = { ...fresh(), brain: { kind: "included" as const, model: SUPER, effort: "low" as const } };
    expect(withDraft(fresh(), draft, ctx()).brain).toMatchObject({ model: DEFAULT_MODEL });
    expect(withDraft(fresh(), draft, ctx({ demo: true })).brain).toMatchObject({ model: SUPER });
  });

  it("context sizes read the same in the builder and in Settings", () => {
    expect(contextLabel(131_072)).toBe("128K");
    expect(contextLabel(262_144)).toBe("256K");
    expect(contextLabel(1_024_000)).toBe("1M");
    expect(contextLabel(1_048_576)).toBe("1M");
    expect(contextLabel(undefined)).toBeNull();
  });
});
