import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { listBots, listBridgeDevices } from "@/lib/data";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/devices";
import { desktopApp } from "@/lib/meetings";
import { PageContainer, PageHeader } from "@/components/account/PageHeader";
import { DesktopDevices } from "@/components/account/DesktopDevices";
import { toDeviceView } from "@/components/account/bridge-shared";
import { DesktopAppSection } from "@/components/meetings/DesktopAppSection";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Desktop app" };

export default async function DesktopPage() {
  const user = await requireUser("/app/desktop");
  const db = await getDb();
  const [rows, bots] = await Promise.all([listBridgeDevices(db, user.id), listBots(db, user.id)]);
  const now = Date.now();
  const devices = rows.filter((d) => !d.revokedAt).map((d) => toDeviceView(d, now, DEVICE_ONLINE_MS));
  const star = bots[0]?.bot;

  return (
    <PageContainer>
      <PageHeader
        title="Desktop app"
        description="Meeting notes and voice typing happen in the Build-a-bot app on your Mac or Windows PC, paired with your account here."
      />
      <div className="flex flex-col gap-12">
        <DesktopAppSection
          app={desktopApp()}
          devices={devices}
          bot={star ? { id: star.id, name: star.name, avatar: star.avatar as AvatarId, color: star.color as ColorwayId } : undefined}
        />
        <DesktopDevices initialDevices={devices} serverNow={now} />
      </div>
    </PageContainer>
  );
}
