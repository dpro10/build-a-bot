import { authed, json } from "@/lib/api";
import { listBridgeDevices } from "@/lib/data";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/jobs";
import { toDeviceView } from "@/components/account/bridge-shared";

/** The owner's paired computers (not revoked), with live online status. Polled by the Bridge page. */
export async function GET() {
  const a = await authed();
  if (!a.ok) return a.res;
  const now = Date.now();
  const devices = await listBridgeDevices(a.db, a.user.id);
  return json(
    { devices: devices.filter((d) => !d.revokedAt).map((d) => toDeviceView(d, now, DEVICE_ONLINE_MS)) },
    { headers: { "cache-control": "no-store" } },
  );
}
