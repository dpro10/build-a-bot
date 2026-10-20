/**
 * Paired computers (the desktop app), as the Desktop app page and GET /api/bridge/devices show
 * them. No secrets here: the device token hash never leaves the server.
 */
import type { BridgeDevice } from "@/lib/db/schema";

export type DeviceView = {
  id: string;
  name: string;
  platform: string | null;
  platformLabel: string;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

/** The desktop app pairs with a "desktop-" platform (older pairings could be other computers). */
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

export function toDeviceView(d: BridgeDevice, now: number, onlineWindowMs: number): DeviceView {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    platformLabel: platformLabel(d.platform),
    online: Boolean(d.lastSeenAt && now - d.lastSeenAt.getTime() < onlineWindowMs),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
