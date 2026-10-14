/**
 * <Avatar /> renders one of the five Build-a-bot characters as inline SVG.
 *
 * Server-component safe: no hooks, no browser APIs. Motion comes from the global
 * classes in ./avatar.css (import it once from the root layout); without that
 * stylesheet the avatar still renders, just still.
 */
import type { JSX } from "react";
import { AVATARS, type AvatarId, type AvatarMood, type ColorwayId } from "@/lib/avatars";
import { blip } from "./characters/blip";
import { ember } from "./characters/ember";
import { nimbus } from "./characters/nimbus";
import { otto } from "./characters/otto";
import { sprout } from "./characters/sprout";
import { INK, Overlay, cx, palette, url, type CharacterSpec } from "./parts";

export type AvatarProps = {
  avatar: AvatarId;
  /** Defaults to the character's own colorway (AVATARS[avatar].defaultColor). */
  color?: ColorwayId;
  /** idle | happy | thinking | working | sleeping (paused) | alert (needs approval). Default "idle". */
  mood?: AvatarMood;
  /** Rendered width and height in px. Default 96. */
  size?: number;
  /** Idle bob, blinks and mood motion. false renders a still pose. Default true. */
  animated?: boolean;
  className?: string;
  /** Accessible label. Default "<Character> the <species>", e.g. "Blip the robot". */
  title?: string;
};

const CHARACTERS: Record<AvatarId, CharacterSpec> = { blip, nimbus, sprout, ember, otto };

/**
 * Below this size the avatar switches to a tighter crop with no ground shadow
 * and no decorative sparkles, so the face stays legible in chat bubbles.
 */
const COMPACT_BELOW = 64;

export function Avatar({ avatar, color, mood = "idle", size = 96, animated = true, className, title }: AvatarProps): JSX.Element {
  const def = AVATARS[avatar] ?? AVATARS.blip;
  const spec = CHARACTERS[def.id];
  const p = palette(color ?? def.defaultColor);
  const id = (part: string) => `bab-${def.id}-${p.id}-${part}`;
  const label = title ?? `${def.character} the ${def.species}`;
  const compact = size < COMPACT_BELOW;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={compact ? "18 14 164 164" : "0 0 200 200"}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={cx("bab-av", `bab-av--${def.id}`, `bab-av--${mood}`, compact && "bab-av--compact", !animated && "bab-av-still", className)}
    >
      <title>{label}</title>
      {compact ? null : (
        <g className="bab-av-ground">
          <defs>
            <radialGradient id={id("shadow")}>
              <stop offset={0} stopColor={INK} stopOpacity={0.24} />
              <stop offset={0.6} stopColor={INK} stopOpacity={0.11} />
              <stop offset={1} stopColor={INK} stopOpacity={0} />
            </radialGradient>
          </defs>
          <ellipse className="bab-av-shadow" cx={100} cy={182} rx={spec.shadow} ry={8} fill={url(id("shadow"))} />
        </g>
      )}
      <g className="bab-av-motion">
        {mood === "sleeping" ? (
          <defs>
            <filter id={id("dim")} colorInterpolationFilters="sRGB">
              <feColorMatrix type="saturate" values="0.6" />
            </filter>
          </defs>
        ) : null}
        <g className={cx("bab-av-body", mood === "sleeping" && "bab-av-dim")} filter={mood === "sleeping" ? url(id("dim")) : undefined}>
          {spec.render({ p, mood, id, compact })}
        </g>
        <Overlay mood={mood} p={p} x={spec.anchor.x} y={spec.anchor.y} k={compact ? 1.2 : 1} />
      </g>
    </svg>
  );
}
