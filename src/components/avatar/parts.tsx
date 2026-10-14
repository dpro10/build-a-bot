/**
 * Shared "face kit" and effects for the Build-a-bot characters.
 *
 * Every character uses the same eyes, mouths, blush, sparkles and status
 * overlays from this file, so the five read as one family. All geometry is in
 * the 200x200 avatar viewBox. Pure SVG, no hooks: safe in Server Components.
 */
import type { CSSProperties, ReactNode } from "react";
import { COLORWAYS, type AvatarMood, type Colorway, type ColorwayId } from "@/lib/avatars";

/** Eye and mouth ink: a deep aubergine rather than pure black, softer next to the gradients. */
export const INK = "#2A2340";
/** Ink for faces drawn on a dark surface (Blip's screen, the Midnight colorway). */
export const GLOW_INK = "#F2F0FF";
/** Status color for the "needs you" badge. */
export const ALERT = "#FF4D5E";
export const TONGUE = "#FF7F9A";

export type Palette = Colorway & {
  /** Eyes and mouth. */
  ink: string;
  /** Eye highlight; null when the eyes are light (they glow instead). */
  shine: string | null;
  blush: string;
  blushOpacity: number;
  /** The body is dark enough that the face switches to light ink. */
  dark: boolean;
  /** Appendages (feet, ears, antenna, arms): one step lighter on dark palettes so they hold up on dark pages. */
  limb: string;
  limbLight: string;
};

/**
 * Cheek color per colorway. Pink on a green or warm body mixes toward gray or
 * brown, so those get a stronger, cooler pink.
 */
const BLUSH: Record<ColorwayId, readonly [color: string, opacity: number]> = {
  ocean: ["#FF8DBA", 0.75],
  sky: ["#FF86B4", 0.7],
  grape: ["#FF8ACB", 0.7],
  rose: ["#E0306E", 0.5],
  coral: ["#E8336A", 0.48],
  sunny: ["#FF6B86", 0.6],
  mint: ["#FF5C93", 0.78],
  midnight: ["#FF8DBA", 0.6],
};

export function palette(id: ColorwayId): Palette {
  const c = COLORWAYS[id] ?? COLORWAYS.ocean;
  const dark = c.id === "midnight";
  const [blush, blushOpacity] = BLUSH[c.id];
  return {
    ...c,
    ink: dark ? GLOW_INK : INK,
    shine: dark ? null : "#FFFFFF",
    blush,
    blushOpacity,
    dark,
    limb: dark ? c.base : c.deep,
    limbLight: dark ? c.light : c.base,
  };
}

/** What every character renderer receives. */
export type CharacterProps = {
  p: Palette;
  mood: AvatarMood;
  /** Deterministic, page-safe id for a gradient: bab-<avatar>-<color>-<part>. */
  id: (part: string) => string;
  /** Small render (chat bubbles, lists): skip decorative extras that turn into specks. */
  compact: boolean;
};

export type CharacterSpec = {
  render: (props: CharacterProps) => ReactNode;
  /** Top-right point near the head where status overlays (dots, z's, badge) sit. */
  anchor: { x: number; y: number };
  /** Ground shadow half-width. */
  shadow: number;
};

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export const url = (id: string) => `url(#${id})`;

/** Round to 2 decimals so computed geometry doesn't leak float noise into the markup. */
export const f = (v: number) => Math.round(v * 100) / 100;
/** Round every number in an SVG path string. */
export const rp = (d: string) => d.replace(/-?\d*\.\d+/g, (m) => String(f(parseFloat(m))));

/** Mix two #RRGGBB colors; t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (v: number, shift: number) => (v >> shift) & 255;
  const m = (shift: number) => Math.round(ch(pa, shift) + (ch(pb, shift) - ch(pa, shift)) * t);
  return `#${((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1).toUpperCase()}`;
}

/** Phase offset for a looping animation (negative delay: starts mid-cycle, no first-frame jump). */
export const phase = (s: number): CSSProperties => ({ animationDelay: `${s === 0 ? 0 : -s}s` });

/* ------------------------------------------------------------------ */
/* Gradients                                                           */
/* ------------------------------------------------------------------ */

type Stop = readonly [offset: number, color: string, opacity?: number];

function Stops({ stops }: { stops: Stop[] }) {
  return (
    <>
      {stops.map(([offset, color, opacity], i) => (
        <stop key={i} offset={offset} stopColor={color} stopOpacity={f(opacity ?? 1)} />
      ))}
    </>
  );
}

export function Radial({ id, x, y, r, stops }: { id: string; x: number; y: number; r: number; stops: Stop[] }) {
  return (
    <radialGradient id={id} cx={x} cy={y} r={r} gradientUnits="userSpaceOnUse">
      <Stops stops={stops} />
    </radialGradient>
  );
}

export function Linear({ id, x1, y1, x2, y2, stops }: { id: string; x1: number; y1: number; x2: number; y2: number; stops: Stop[] }) {
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
      <Stops stops={stops} />
    </linearGradient>
  );
}

/**
 * The family's body shading: light from the top-left, settling into the
 * colorway's deep tone at the bottom-right edge.
 */
export function BodyGradient({ id, p, x, y, r }: { id: string; p: Palette; x: number; y: number; r: number }) {
  return <Radial id={id} x={x} y={y} r={r} stops={[[0, p.light], [0.52, p.base], [1, p.deep]]} />;
}

/** Soft white sheen used for the top-left highlight on every body. */
export function SheenGradient({ id }: { id: string }) {
  return (
    <radialGradient id={id}>
      <Stops stops={[[0, "#FFFFFF", 0.5], [1, "#FFFFFF", 0]]} />
    </radialGradient>
  );
}

/** A glow (antenna bulb, LED eyes): color in the middle fading out. */
export function GlowGradient({ id, color, strength = 0.6 }: { id: string; color: string; strength?: number }) {
  return (
    <radialGradient id={id}>
      <Stops stops={[[0, color, strength], [0.55, color, strength * 0.35], [1, color, 0]]} />
    </radialGradient>
  );
}

/** The highlight pair every body gets: a soft sheen blob plus a short glossy arc. */
export function Sheen({ id, x, y, rx, ry, rotate = -28, arc }: { id: string; x: number; y: number; rx: number; ry: number; rotate?: number; arc?: string }) {
  return (
    <g className="bab-av-sheen" pointerEvents="none">
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={url(id)} transform={`rotate(${rotate} ${x} ${y})`} />
      {arc ? <path d={arc} fill="none" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" /> : null}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Face                                                                */
/* ------------------------------------------------------------------ */

export type FaceProps = {
  /** Midpoint between the eyes. */
  x: number;
  y: number;
  /** Half the distance between the eye centers. */
  gap?: number;
  /** Scale for eyes, mouth and blush. */
  s?: number;
  mood: AvatarMood;
  p: Palette;
  /** Gradient id for the cheeks. */
  blushId: string;
  ink?: string;
  shine?: string | null;
  /** Mouth distance below the eye line. */
  mouthDy?: number;
  blush?: boolean;
  /** Replace the mouth (Blip shows a progress bar while working). */
  mouth?: ReactNode;
};

export function Face({ x, y, gap = 18, s = 1, mood, p, blushId, ink = p.ink, shine = p.shine, mouthDy = 15, blush = true, mouth }: FaceProps) {
  const my = y + (mouthDy + (mood === "working" ? 1.5 : 0)) * s;
  return (
    <g className="bab-av-face">
      {blush ? <Blush x={x} y={y} gap={gap} s={s} mood={mood} p={p} gid={blushId} /> : null}
      <Eyes x={x} y={y} gap={gap} s={s} mood={mood} ink={ink} shine={shine} />
      {mouth ?? <Mouth x={mood === "thinking" ? x + 4 * s : x} y={my} s={s} mood={mood} ink={ink} />}
    </g>
  );
}

function Blush({ x, y, gap, s, mood, p, gid }: { x: number; y: number; gap: number; s: number; mood: AvatarMood; p: Palette; gid: string }) {
  const a = mood === "happy" ? Math.min(1, p.blushOpacity + 0.15) : mood === "alert" ? p.blushOpacity * 0.7 : p.blushOpacity;
  const dx = gap + 13.5 * s;
  const dy = 11.5 * s;
  return (
    <g className="bab-av-blush">
      <defs>
        <radialGradient id={gid}>
          <Stops stops={[[0, p.blush, a], [0.55, p.blush, a * 0.75], [1, p.blush, 0]]} />
        </radialGradient>
      </defs>
      <ellipse cx={f(x - dx)} cy={f(y + dy)} rx={f(10 * s)} ry={f(6.4 * s)} fill={url(gid)} />
      <ellipse cx={f(x + dx)} cy={f(y + dy)} rx={f(10 * s)} ry={f(6.4 * s)} fill={url(gid)} />
    </g>
  );
}

function Eyes({ x, y, gap, s, mood, ink, shine }: { x: number; y: number; gap: number; s: number; mood: AvatarMood; ink: string; shine: string | null }) {
  const L = x - gap;
  const R = x + gap;
  const stroke = { fill: "none", stroke: ink, strokeLinecap: "round", strokeLinejoin: "round" } as const;

  if (mood === "happy") {
    const d = (ex: number) => `M${ex - 7.5 * s} ${y + 3 * s}Q${ex} ${y - 8.5 * s} ${ex + 7.5 * s} ${y + 3 * s}`;
    return (
      <g className="bab-av-eyes" {...stroke} strokeWidth={f(4.4 * s)}>
        <path d={rp(d(L))} />
        <path d={rp(d(R))} />
      </g>
    );
  }

  if (mood === "sleeping") {
    const d = (ex: number) => `M${ex - 7.5 * s} ${y}Q${ex} ${y + 6.5 * s} ${ex + 7.5 * s} ${y}`;
    return (
      <g className="bab-av-eyes" {...stroke} strokeWidth={f(3.8 * s)}>
        <path d={rp(d(L))} />
        <path d={rp(d(R))} />
      </g>
    );
  }

  const big = mood === "alert";
  const rx = (big ? 9.6 : 8.2) * s;
  const ry = (big ? 12.2 : mood === "working" ? 10 : 10.8) * s;
  // Thinking: the gaze drifts up and to the side. Working: eyes down on the task.
  const ox = mood === "thinking" ? 2.8 * s : mood === "working" ? -1.2 * s : 0;
  const oy = mood === "thinking" ? -3.6 * s : mood === "working" ? 2.6 * s : 0;
  const eye = (ex: number) => (
    <g>
      <ellipse cx={f(ex + ox)} cy={f(y + oy)} rx={f(rx)} ry={f(ry)} fill={ink} />
      {shine ? (
        <>
          <circle cx={f(ex + ox + rx * 0.34)} cy={f(y + oy - ry * 0.36)} r={f((big ? 3.7 : 3.1) * s)} fill={shine} />
          <circle cx={f(ex + ox - rx * 0.3)} cy={f(y + oy + ry * 0.42)} r={f((big ? 1.7 : 1.4) * s)} fill={shine} opacity={0.75} />
        </>
      ) : null}
    </g>
  );
  const eyes = (
    <g className="bab-av-eyes bab-av-blink">
      {eye(L)}
      {eye(R)}
    </g>
  );
  return mood === "idle" ? <g className="bab-av-look">{eyes}</g> : eyes;
}

function Mouth({ x, y, s, mood, ink }: { x: number; y: number; s: number; mood: AvatarMood; ink: string }) {
  const line = { fill: "none", stroke: ink, strokeWidth: f(3.4 * s), strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (mood) {
    case "happy":
      return (
        <g className="bab-av-mouth">
          <path
            d={rp(`M${x - 9 * s} ${y - 2 * s}C${x - 8 * s} ${y + 11 * s} ${x + 8 * s} ${y + 11 * s} ${x + 9 * s} ${y - 2 * s}Z`)}
            fill={ink}
            stroke={ink}
            strokeWidth={f(2 * s)}
            strokeLinejoin="round"
          />
          <path d={rp(`M${x - 4.6 * s} ${y + 6.4 * s}Q${x} ${y + 2.6 * s} ${x + 4.6 * s} ${y + 6.4 * s}Q${x} ${y + 9.6 * s} ${x - 4.6 * s} ${y + 6.4 * s}Z`)} fill={TONGUE} />
        </g>
      );
    case "thinking":
      return <path className="bab-av-mouth" d={rp(`M${x - 4.5 * s} ${y + 1.8 * s}L${x + 2 * s} ${y + 1.2 * s}Q${x + 4.6 * s} ${y + 1 * s} ${x + 5.6 * s} ${y - 0.8 * s}`)} {...line} />;
    case "working":
      return (
        <g className="bab-av-mouth">
          <path d={rp(`M${x + 1.2 * s} ${y + 1.6 * s}Q${x + 1.6 * s} ${y + 8 * s} ${x + 5.2 * s} ${y + 7.4 * s}Q${x + 8.6 * s} ${y + 6.6 * s} ${x + 6.8 * s} ${y + 1.2 * s}Z`)} fill={TONGUE} />
          <path d={rp(`M${x - 5 * s} ${y + 0.6 * s}Q${x + 1 * s} ${y + 3.4 * s} ${x + 7 * s} ${y + 0.6 * s}`)} {...line} />
        </g>
      );
    case "sleeping":
      return <ellipse className="bab-av-mouth" cx={f(x)} cy={f(y + 2 * s)} rx={f(3 * s)} ry={f(2.5 * s)} fill={ink} />;
    case "alert":
      return <ellipse className="bab-av-mouth" cx={f(x)} cy={f(y + 2.5 * s)} rx={f(4.3 * s)} ry={f(5.2 * s)} fill={ink} />;
    default:
      return <path className="bab-av-mouth" d={rp(`M${x - 5.5 * s} ${y}Q${x} ${y + 5.5 * s} ${x + 5.5 * s} ${y}`)} {...line} />;
  }
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

/** Four-point sparkle, the family's one decorative shape. */
export function sparklePath(x: number, y: number, r: number): string {
  const k = r * 0.2;
  return rp(`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`);
}

export function Sparkle({ x, y, r, color, d = 0 }: { x: number; y: number; r: number; color: string; d?: number }) {
  return <path className="bab-av-sparkle" d={sparklePath(x, y, r)} fill={color} style={phase(d)} />;
}

/** Two sparkles for happy/working moods; omitted at small sizes. */
export function Sparkles({ p, at }: { p: Palette; at: ReadonlyArray<readonly [x: number, y: number, r: number]> }) {
  return (
    <g className="bab-av-sparkles">
      {at.map(([x, y, r], i) => (
        <Sparkle key={i} x={x} y={y} r={r} color={p.accent} d={i * 0.7} />
      ))}
    </g>
  );
}

/** Status overlays shared by every character, placed at the character's anchor. */
export function Overlay({ mood, p, x, y, k = 1 }: { mood: AvatarMood; p: Palette; x: number; y: number; k?: number }) {
  const body =
    mood === "thinking" ? <ThinkingDots x={x} y={y} p={p} /> : mood === "sleeping" ? <Zzz x={x} y={y} p={p} /> : mood === "alert" ? <AlertBadge x={x} y={y} /> : null;
  if (!body) return null;
  return k === 1 ? body : <g transform={`translate(${x} ${y}) scale(${k}) translate(${-x} ${-y})`}>{body}</g>;
}

function ThinkingDots({ x, y, p }: { x: number; y: number; p: Palette }) {
  const edge = p.dark ? p.light : p.deep;
  return (
    <g className="bab-av-thought">
      <g fill="#FFFFFF" stroke={edge} strokeOpacity={0.28} strokeWidth={2}>
        <circle cx={x - 25} cy={y + 25} r={3.2} />
        <circle cx={x - 17} cy={y + 16} r={5} />
        <rect x={x - 19} y={y - 12} width={42} height={24} rx={12} />
      </g>
      <g fill={p.dark ? p.base : p.deep}>
        <circle className="bab-av-dot" cx={x - 8} cy={y} r={3.6} />
        <circle className="bab-av-dot" cx={x + 2} cy={y} r={3.6} style={phase(1.1)} />
        <circle className="bab-av-dot" cx={x + 12} cy={y} r={3.6} style={phase(0.9)} />
      </g>
    </g>
  );
}

function Zzz({ x, y, p }: { x: number; y: number; p: Palette }) {
  const z = (zx: number, zy: number, w: number) => `M${zx} ${zy}h${w}l${-w} ${w}h${w}`;
  const glyphs = [
    { d: z(x - 18, y + 14, 9), t: 0 },
    { d: z(x - 3, y - 2, 12), t: 1.8 },
    { d: z(x + 14, y - 21, 15), t: 0.9 },
  ];
  const ink = p.dark ? p.base : p.deep;
  return (
    <g className="bab-av-zzz" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {glyphs.map((g, i) => (
        <g key={i} className="bab-av-z" style={phase(g.t)}>
          <path d={g.d} stroke="#FFFFFF" strokeWidth={8} />
          <path d={g.d} stroke={ink} strokeWidth={3.6} />
        </g>
      ))}
    </g>
  );
}

function AlertBadge({ x, y }: { x: number; y: number }) {
  return (
    <g className="bab-av-badge">
      <circle cx={x} cy={y} r={17} fill={ALERT} stroke="#FFFFFF" strokeWidth={3.5} />
      <rect x={x - 2.7} y={y - 10} width={5.4} height={12.5} rx={2.7} fill="#FFFFFF" />
      <circle cx={x} cy={y + 7.6} r={3} fill="#FFFFFF" />
    </g>
  );
}
