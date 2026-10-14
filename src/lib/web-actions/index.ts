/**
 * Web actions (beta): the bot reads websites and fills in forms in a cloud browser,
 * never the owner's own. Reading runs freely; filling stops before the send button;
 * sending always waits for the owner's tap on a preview (policy reason "always_ask").
 *
 * Provider: Browser Use Cloud when BROWSER_USE_API_KEY is set; otherwise a simulated
 * browser in demo mode; otherwise "not set up". Server-only; UI code imports
 * `@/lib/web-actions/types` instead.
 */
import { config } from "@/lib/env";
import { createBrowserUseProvider } from "./browser-use";
import { createDemoWebProvider } from "./demo";
import type { WebActionsProvider } from "./types";

let demoProvider: WebActionsProvider | null = null;

function demo(): WebActionsProvider {
  return (demoProvider ??= createDemoWebProvider());
}

function live(): WebActionsProvider | null {
  const { apiKey, ...rest } = config.browserUse;
  return apiKey ? createBrowserUseProvider({ apiKey, ...rest }) : null;
}

/** The browser new tasks run in: live when a key is set, simulated in demo mode, else null. */
export function webActionsProvider(opts: { demo: boolean }): WebActionsProvider | null {
  return live() ?? (opts.demo ? demo() : null);
}

/** The browser that filled a stored form (a simulated fill can only be "sent" by the simulated browser). */
export function providerById(id: WebActionsProvider["id"]): WebActionsProvider | null {
  return id === "demo" ? demo() : live();
}

export type * from "./types";
export { readWebFormPreview } from "./types";
export { readWebSessionScreenshot, webSessionPreviewPath } from "./store";
