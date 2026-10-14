import { ImageResponse } from "next/og";
import { avatarDataUri } from "@/components/marketing/og/avatar-svg";
import { OG_INK, OG_MUTED, OgLogoMark, ogFonts } from "@/components/marketing/og/shared";
import { AVATAR_IDS, type AvatarMood } from "@/lib/avatars";
import { SITE } from "@/lib/site";

export const alt = "Build-a-bot: your own AI agent, in about a minute. Five friendly bot characters.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MOODS: AvatarMood[] = ["happy", "idle", "happy", "idle", "happy"];
const SIZES = [176, 160, 186, 168, 182];

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: "#FBF9F6",
          backgroundImage:
            "radial-gradient(circle at 8% 0%, rgba(183,166,255,0.55) 0%, rgba(183,166,255,0) 45%), radial-gradient(circle at 100% 10%, rgba(255,207,74,0.38) 0%, rgba(255,207,74,0) 40%), radial-gradient(circle at 70% 115%, rgba(124,92,255,0.22) 0%, rgba(124,92,255,0) 45%)",
          fontFamily: "Bricolage",
          color: OG_INK,
          padding: "56px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <OgLogoMark size={54} />
            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{SITE.name}</div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: OG_MUTED,
              border: "2px solid #E8E2D8",
              borderRadius: 999,
              padding: "8px 20px",
              backgroundColor: "rgba(255,255,255,0.7)",
            }}
          >
            {SITE.domain}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 44 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1, letterSpacing: -3.5 }}>Your own AI agent,</div>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3.5, color: "#6D4DFF" }}>in about a minute.</div>
          <div style={{ fontSize: 30, color: OG_MUTED, marginTop: 22, maxWidth: 760, lineHeight: 1.3 }}>
            Pick a face, name it, give it a brain and your apps. Talk to it anywhere.
          </div>
        </div>

        <div style={{ position: "absolute", right: 40, bottom: 14, display: "flex", alignItems: "flex-end" }}>
          {AVATAR_IDS.map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={avatarDataUri(id, { mood: MOODS[i], size: SIZES[i] })} width={SIZES[i]} height={SIZES[i]} alt="" style={{ marginLeft: i === 0 ? 0 : -18 }} />
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
