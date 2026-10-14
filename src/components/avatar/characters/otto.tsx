/**
 * Otto, the octopus: a round head over curling, tapered arms that are always up
 * to something (waving, juggling little app tiles, propping its cheek while it
 * thinks). Curious, witty, a multitasker.
 */
import type { AvatarMood } from "@/lib/avatars";
import { BodyGradient, Face, SheenGradient, Sheen, Sparkles, mix, phase, url, type CharacterProps, type CharacterSpec } from "../parts";

type Pt = readonly [number, number];
type Arm = { x: number; y: number; d: string; wave?: "l" | "r" };

/** Centerlines (relative to the arm's root), drawn for the left side; mirror() makes the right. */
const OUTER_IDLE = "M0 0C-8 18 -22 30 -36 28C-46 26 -48 16 -40 13";
const INNER_IDLE = "M0 0C0 18 -4 34 -14 40C-22 44 -28 38 -24 33";
const OUTER_UP = "M0 0C-14 -4 -28 -18 -32 -36C-34 -46 -26 -50 -22 -43";
const OUTER_TUCK = "M0 0C-6 12 -16 20 -24 18C-30 16 -30 10 -25 9";
const INNER_TUCK = "M0 0C0 14 -4 24 -12 28C-18 30 -22 26 -19 22";
const OUTER_SURPRISE = "M0 0C-14 -2 -30 -12 -38 -26C-42 -34 -36 -40 -31 -34";
const OUTER_CHEEK = "M0 0C-14 -4 -24 -18 -24 -34C-24 -44 -16 -48 -11 -42";

const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

const mirror = (d: string) => {
  const n = nums(d);
  let out = `M${-n[0]} ${n[1]}`;
  for (let i = 2; i < n.length; i += 6) out += `C${-n[i]} ${n[i + 1]} ${-n[i + 2]} ${n[i + 3]} ${-n[i + 4]} ${n[i + 5]}`;
  return out;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

const W_ROOT = 19;
const W_TIP = 9;
const halfWidth = (g: number) => (W_ROOT + (W_TIP - W_ROOT) * Math.pow(g, 0.85)) / 2;

/** Points and unit tangents along a cubic centerline ("M x y C ... C ..."). */
function sample(d: string): { p: Pt; t: Pt }[] {
  const n = nums(d);
  const pts: Pt[] = [];
  for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  const samples: { p: Pt; t: Pt }[] = [];
  const steps = 18;
  for (let s = 0; s + 3 < pts.length; s += 3) {
    const [a, b, c, e] = [pts[s], pts[s + 1], pts[s + 2], pts[s + 3]];
    for (let i = s === 0 ? 0 : 1; i <= steps; i++) {
      const u = i / steps;
      const m = 1 - u;
      const x = m * m * m * a[0] + 3 * m * m * u * b[0] + 3 * m * u * u * c[0] + u * u * u * e[0];
      const y = m * m * m * a[1] + 3 * m * m * u * b[1] + 3 * m * u * u * c[1] + u * u * u * e[1];
      const dx = 3 * m * m * (b[0] - a[0]) + 6 * m * u * (c[0] - b[0]) + 3 * u * u * (e[0] - c[0]);
      const dy = 3 * m * m * (b[1] - a[1]) + 6 * m * u * (c[1] - b[1]) + 3 * u * u * (e[1] - c[1]);
      const len = Math.hypot(dx, dy) || 1;
      samples.push({ p: [x, y], t: [dx / len, dy / len] });
    }
  }
  return samples;
}

/** Poses are constants, so outlines are computed once per centerline. */
const memo = <T,>(fn: (d: string) => T) => {
  const cache = new Map<string, T>();
  return (d: string): T => {
    let v = cache.get(d);
    if (v === undefined) cache.set(d, (v = fn(d)));
    return v;
  };
};

/** A filled outline around the centerline, tapering from root to a round tip. */
const taper = memo(function taper(d: string): string {
  const samples = sample(d);
  const left: Pt[] = [];
  const right: Pt[] = [];
  samples.forEach(({ p, t }, i) => {
    const hw = halfWidth(i / (samples.length - 1));
    left.push([p[0] - t[1] * hw, p[1] + t[0] * hw]);
    right.push([p[0] + t[1] * hw, p[1] - t[0] * hw]);
  });
  const w1 = W_TIP;
  const last = samples.length - 1;
  let out = `M${r1(left[0][0])} ${r1(left[0][1])}`;
  for (let i = 1; i <= last; i++) out += `L${r1(left[i][0])} ${r1(left[i][1])}`;
  out += `A${w1 / 2} ${w1 / 2} 0 0 0 ${r1(right[last][0])} ${r1(right[last][1])}`;
  for (let i = last - 1; i >= 0; i--) out += `L${r1(right[i][0])} ${r1(right[i][1])}`;
  return out + "Z";
});

/** Small suckers along the inside of an arm's curl. */
const suckers = memo(function suckers(d: string): Array<readonly [x: number, y: number, r: number]> {
  const samples = sample(d);
  const n = samples.length - 1;
  return [0.58, 0.71, 0.84].map((g) => {
    const i = Math.round(g * n);
    const { p, t } = samples[i];
    const next = samples[Math.min(n, i + 1)].t;
    const turn = t[0] * next[1] - t[1] * next[0] >= 0 ? 1 : -1;
    const off = halfWidth(g) - 2.8;
    return [r1(p[0] - t[1] * off * turn), r1(p[1] + t[0] * off * turn), r1(2.5 - g * 1.1)] as const;
  });
});

function arms(mood: AvatarMood): Arm[] {
  const L = { x: 68, y: 118 };
  const R = { x: 132, y: 118 };
  const il = { x: 88, y: 124 };
  const ir = { x: 112, y: 124 };
  const inner = [
    { ...il, d: INNER_IDLE },
    { ...ir, d: mirror(INNER_IDLE) },
  ];
  switch (mood) {
    case "happy":
    case "working":
      return [{ ...L, d: OUTER_UP, wave: "l" }, ...inner, { ...R, d: mirror(OUTER_UP), wave: "r" }];
    case "thinking":
      return [{ x: 62, y: 112, d: OUTER_CHEEK }, ...inner, { ...R, d: mirror(OUTER_IDLE), wave: "r" }];
    case "sleeping":
      return [
        { ...L, d: OUTER_TUCK },
        { ...il, d: INNER_TUCK },
        { ...ir, d: mirror(INNER_TUCK) },
        { ...R, d: mirror(OUTER_TUCK) },
      ];
    case "alert":
      return [{ ...L, d: OUTER_SURPRISE }, ...inner, { ...R, d: mirror(OUTER_SURPRISE) }];
    default:
      return [{ ...L, d: OUTER_IDLE, wave: "l" }, ...inner, { ...R, d: mirror(OUTER_IDLE), wave: "r" }];
  }
}

/** Little app tiles Otto juggles while it works. */
const TILES = [
  { x: 31, y: 50, c: "#FFD25A", r: -12, t: 0 },
  { x: 100, y: 18, c: "#5BD1FF", r: 0, t: 0.4 },
  { x: 169, y: 50, c: "#FF7AA8", r: 12, t: 0.8 },
] as const;

function Otto({ p, mood, id, compact }: CharacterProps) {
  return (
    <g className="bab-av-char">
      <defs>
        <BodyGradient id={id("body")} p={p} x={78} y={60} r={120} />
        <linearGradient id={id("arm")} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor={p.limbLight} />
          <stop offset={1} stopColor={p.limb} />
        </linearGradient>
        <SheenGradient id={id("sheen")} />
      </defs>

      {arms(mood).map((a, i) => (
        <g key={i} transform={`translate(${a.x} ${a.y})`}>
          <g className={a.wave ? `bab-av-arm bab-av-arm--${a.wave}` : undefined}>
            <path d={taper(a.d)} fill={url(id("arm"))} />
            {compact ? null : (
              <g fill={mix(p.light, "#FFFFFF", 0.35)} opacity={0.6}>
                {suckers(a.d).map(([x, y, r], j) => (
                  <circle key={j} cx={x} cy={y} r={r} />
                ))}
              </g>
            )}
          </g>
        </g>
      ))}

      <ellipse cx={100} cy={88} rx={52} ry={48} fill={url(id("body"))} />
      <Sheen id={id("sheen")} x={78} y={62} rx={22} ry={12} arc="M61 71.5A43 39 0 0 1 81.8 52.6" />
      <Face x={100} y={98} gap={19} s={compact ? 1.12 : 1} mood={mood} p={p} blushId={id("blush")} />

      {mood === "working" ? (
        <g className="bab-av-tiles">
          {TILES.map((tile) => (
            <g key={tile.x} className="bab-av-tile" style={phase(tile.t)}>
              <g transform={`rotate(${tile.r} ${tile.x} ${tile.y})`}>
                <rect x={tile.x - 10} y={tile.y - 10} width={20} height={20} rx={6} fill={tile.c} />
                <circle cx={tile.x} cy={tile.y} r={4} fill="#FFFFFF" />
              </g>
            </g>
          ))}
        </g>
      ) : null}
      {!compact && mood === "happy" ? (
        <Sparkles
          p={p}
          at={[
            [26, 40, 8],
            [176, 150, 6],
          ]}
        />
      ) : null}
    </g>
  );
}

export const otto: CharacterSpec = { render: Otto, anchor: { x: 156, y: 46 }, shadow: 54 };
