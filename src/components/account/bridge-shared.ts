/**
 * Bridge device shapes shared by the Bridge page (server), its client view and
 * GET /api/bridge/devices. No secrets here: the device token hash never leaves the server.
 */
import type { BridgeDevice } from "@/lib/db/schema";

export type DeviceView = {
  id: string;
  name: string;
  platform: string | null;
  platformLabel: string;
  clis: { claude: string | null; codex: string | null };
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

/** The desktop app (meeting notes) pairs like the Bridge, with a "desktop-" platform. */
export function isDesktopApp(platform: string | null | undefined): boolean {
  return Boolean(platform?.startsWith("desktop-"));
}

/** "darwin-arm64" → "Mac (Apple silicon)" (also "desktop-darwin-arm64", from the desktop app) */
export function platformLabel(platform: string | null): string {
  if (!platform) return "Computer";
  const [os, arch] = platform.replace(/^desktop-/, "").split("-");
  if (os === "darwin") return arch === "arm64" ? "Mac (Apple silicon)" : "Mac (Intel)";
  if (os === "win32") return "Windows PC";
  if (os === "linux") return "Linux";
  return os;
}

/** "2.1.3 (Claude Code)" → "2.1.3"; "codex-cli 0.40.0" → "0.40.0" */
export function cliVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /\d+\.\d+(?:\.\d+)?/.exec(raw);
  return m ? m[0] : raw.slice(0, 24);
}

export function toDeviceView(d: BridgeDevice, now: number, onlineWindowMs: number): DeviceView {
  const clis = (d.clis ?? {}) as Record<string, string | null>;
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    platformLabel: platformLabel(d.platform),
    clis: { claude: clis.claude ?? null, codex: clis.codex ?? null },
    online: Boolean(d.lastSeenAt && now - d.lastSeenAt.getTime() < onlineWindowMs),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
