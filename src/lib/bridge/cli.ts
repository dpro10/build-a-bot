import { appUrl } from "@/lib/env";

/**
 * How owners start the Bridge on their computer. `npx build-a-bot-bridge` once it's on npm;
 * a local server is run from this repo, where it's a file. BRIDGE_CLI overrides both
 * (e.g. "node bridge/bab-bridge.mjs" on a preview, before the package is published).
 */
export function bridgeCli(server = appUrl()): string {
  const override = process.env.BRIDGE_CLI?.trim();
  if (override) return override;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(server) ? "node bridge/bab-bridge.mjs" : "npx build-a-bot-bridge";
}
