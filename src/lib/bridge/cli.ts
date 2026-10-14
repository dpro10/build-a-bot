import { appUrl } from "@/lib/env";
import bridgePackage from "../../../bridge/package.json";

/** The Bridge as the site serves it (packed before each build by scripts/pack-bridge.mjs). */
export const BRIDGE_TARBALL = `downloads/build-a-bot-bridge-${bridgePackage.version}.tgz`;

/**
 * How owners start the Bridge on their computer. A local server is run from this repo, where
 * it's a file; any other server hands out its own copy, which npx runs straight from the URL
 * (nothing on npm, so no lookalike package can stand in for it). BRIDGE_CLI overrides both.
 */
export function bridgeCli(server = appUrl()): string {
  const override = process.env.BRIDGE_CLI?.trim();
  if (override) return override;
  const base = server.replace(/\/$/, "");
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(base) ? "node bridge/bab-bridge.mjs" : `npx -y ${base}/${BRIDGE_TARBALL}`;
}
