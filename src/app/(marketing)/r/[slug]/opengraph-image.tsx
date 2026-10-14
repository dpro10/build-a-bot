import { ImageResponse } from "next/og";
import { avatarDataUri } from "@/components/marketing/og/avatar-svg";
import { OG_INK, OG_MUTED, OgLogoMark, ogFonts } from "@/components/marketing/og/shared";
import { loadRecipe } from "@/components/marketing/recipes/load";
import { COLORWAYS } from "@/lib/avatars";
import { SITE } from "@/lib/site";
import { TRUST } from "@/lib/trust";
import { truncate } from "@/lib/utils";

export const alt = "A Build-a-bot recipe: a ready-made AI bot you can make your own.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const recipe = await loadRecipe(slug);
  const c = COLORWAYS[recipe?.color ?? "grape"];
  const avatar = recipe?.avatar ?? "otto";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#FBF9F6",
          backgroundImage: `radial-gradient(circle at 82% 62%, ${c.light}cc 0%, ${c.light}00 42%), radial-gradient(circle at 100% 0%, ${c.accent}55 0%, ${c.accent}00 40%), linear-gradient(135deg, #FBF9F6 0%, ${c.tint} 100%)`,
          fontFamily: "Bricolage",
          color: OG_INK,
          padding: "56px 64px 56px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 690, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <OgLogoMark size={46} />
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8 }}>{SITE.name}</div>
            <div
              style={{
                display: "flex",
                marginLeft: 10,
                fontSize: 20,
                fontWeight: 700,
                color: c.deep,
                backgroundColor: "rgba(255,255,255,0.75)",
                borderRadius: 999,
                padding: "6px 16px",
                letterSpacing: 1.5,
              }}
            >
              BOT RECIPE
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 48 }}>
            <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1, letterSpacing: -3.5 }}>{truncate(recipe?.title ?? "Bot recipes", 22)}</div>
            <div style={{ fontSize: 28, color: OG_MUTED, marginTop: 16 }}>{truncate(recipe?.subtitle ?? "Ready-made bots you can make your own", 60)}</div>
            <div style={{ fontSize: 36, lineHeight: 1.25, marginTop: 26, maxWidth: 660 }}>
              {truncate(recipe?.tagline ?? "Pick one, make it yours in a tap, then change anything.", 110)}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: "auto" }}>
            {recipe ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 24,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  backgroundColor: c.deep,
                  borderRadius: 999,
                  padding: "10px 22px",
                }}
              >
                {TRUST[recipe.trust].name}
              </div>
            ) : null}
            <div style={{ display: "flex", fontSize: 24, color: OG_MUTED }}>Make it yours at {SITE.domain}</div>
          </div>
        </div>

        <div style={{ position: "absolute", right: 36, bottom: 30, display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarDataUri(avatar, { color: recipe?.color, mood: "happy", size: 430 })} width={430} height={430} alt="" />
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
