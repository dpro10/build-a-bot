/**
 * Static SVG markup for the avatars, for places that can't run React hooks
 * (next/og ImageResponse). <Avatar> itself calls useId(), so instead this calls
 * the characters' pure render functions and serializes the element tree.
 * Motion classes and inline styles (animation phases) are dropped: the result is
 * the still pose.
 */
import { Fragment, isValidElement, type ReactNode } from "react";
import { AVATARS, type AvatarId, type AvatarMood, type ColorwayId } from "@/lib/avatars";
import { blip } from "@/components/avatar/characters/blip";
import { ember } from "@/components/avatar/characters/ember";
import { nimbus } from "@/components/avatar/characters/nimbus";
import { otto } from "@/components/avatar/characters/otto";
import { sprout } from "@/components/avatar/characters/sprout";
import { INK, Overlay, palette, url, type CharacterSpec } from "@/components/avatar/parts";

const CHARACTERS: Record<AvatarId, CharacterSpec> = { blip, nimbus, sprout, ember, otto };

/** SVG attributes that really are camelCase; everything else becomes kebab-case. */
const KEEP_CASE = new Set([
  "viewBox",
  "gradientUnits",
  "gradientTransform",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "preserveAspectRatio",
  "stdDeviation",
  "spreadMethod",
  "pathLength",
  "filterUnits",
  "primitiveUnits",
  "maskUnits",
  "maskContentUnits",
  "clipPathUnits",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "startOffset",
  "textLength",
  "lengthAdjust",
  "baseFrequency",
  "numOctaves",
  "tableValues",
  "kernelMatrix",
]);
const DROP = new Set(["children", "key", "ref", "className", "style"]);

function attrName(name: string): string {
  if (name === "xlinkHref") return "xlink:href";
  if (name === "xmlnsXlink") return "xmlns:xlink";
  if (KEEP_CASE.has(name)) return name;
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function serialize(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return esc(String(node));
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (!isValidElement(node)) return "";
  const { type } = node;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (type === Fragment) return serialize(props.children as ReactNode);
  if (typeof type === "function") return serialize((type as (p: Record<string, unknown>) => ReactNode)(props));
  if (typeof type !== "string") return "";
  let attrs = "";
  for (const [k, v] of Object.entries(props)) {
    if (DROP.has(k) || v === null || v === undefined || v === false) continue;
    attrs += ` ${attrName(k)}="${esc(String(v))}"`;
  }
  const inner = serialize(props.children as ReactNode);
  return inner ? `<${type}${attrs}>${inner}</${type}>` : `<${type}${attrs}/>`;
}

/** A complete standalone SVG document for one character, in its still pose. */
export function avatarSvg(avatar: AvatarId, { color, mood = "idle", size = 200, shadow = true }: { color?: ColorwayId; mood?: AvatarMood; size?: number; shadow?: boolean } = {}): string {
  const def = AVATARS[avatar];
  const spec = CHARACTERS[avatar];
  const p = palette(color ?? def.defaultColor);
  const id = (part: string) => `og-${avatar}-${p.id}-${part}`;
  const tree = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width={size} height={size}>
      {shadow ? (
        <g>
          <defs>
            <radialGradient id={id("shadow")}>
              <stop offset={0} stopColor={INK} stopOpacity={0.24} />
              <stop offset={0.6} stopColor={INK} stopOpacity={0.11} />
              <stop offset={1} stopColor={INK} stopOpacity={0} />
            </radialGradient>
          </defs>
          <ellipse cx={100} cy={182} rx={spec.shadow} ry={8} fill={url(id("shadow"))} />
        </g>
      ) : null}
      <g>
        {spec.render({ p, mood, id, compact: false })}
        <Overlay mood={mood} p={p} x={spec.anchor.x} y={spec.anchor.y} k={1} />
      </g>
    </svg>
  );
  return serialize(tree);
}

export function avatarDataUri(avatar: AvatarId, opts?: Parameters<typeof avatarSvg>[1]): string {
  return `data:image/svg+xml;base64,${Buffer.from(avatarSvg(avatar, opts)).toString("base64")}`;
}
