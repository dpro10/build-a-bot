/**
 * Sprout, the seedling: a round, sturdy little body with a stem and two leaves
 * that sway (and perk up, droop or flutter with its mood). Kind, steady, encouraging.
 */
import type { AvatarMood } from "@/lib/avatars";
import { BodyGradient, Face, SheenGradient, Sheen, Sparkles, rp, url, type CharacterProps, type CharacterSpec } from "../parts";

const BODY = "M100 76C135 76 157 99 157 128C157 157 134 172 100 172C66 172 43 157 43 128C43 99 65 76 100 76Z";
const LEAF = { light: "#C2F27F", base: "#74D45E", deep: "#2E9E57" };

/** A leaf pointing along +x from its base at (0,0); the fuller side faces -y. */
const leaf = (l: number) =>
  rp(`M0 0C${l * 0.24} ${-l * 0.44} ${l * 0.72} ${-l * 0.44} ${l} 0C${l * 0.7} ${l * 0.3} ${l * 0.24} ${l * 0.3} 0 0Z`);
const rib = (l: number) => rp(`M${l * 0.14} ${-l * 0.02}Q${l * 0.5} ${-l * 0.09} ${l * 0.82} ${-l * 0.03}`);

/** Leaf angles (degrees up from horizontal) per mood. */
const ANGLES: Record<AvatarMood, readonly [left: number, right: number]> = {
  idle: [30, 36],
  happy: [46, 50],
  thinking: [22, 54],
  working: [34, 40],
  sleeping: [2, 6],
  alert: [64, 66],
  // One leaf perks up like an ear.
  listening: [32, 62],
};

function Leaf({ side, angle, length, fill }: { side: "l" | "r"; angle: number; length: number; fill: string }) {
  const t = side === "l" ? `rotate(${angle}) scale(-1 1)` : `rotate(${-angle})`;
  return (
    <g className={`bab-av-leaf bab-av-leaf--${side}`}>
      <g transform={t}>
        <path d={leaf(length)} fill={fill} />
        <path d={rib(length)} fill="none" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={2.4} strokeLinecap="round" />
      </g>
    </g>
  );
}

function Sprout({ p, mood, id, compact }: CharacterProps) {
  const [la, ra] = ANGLES[mood];
  return (
    <g className="bab-av-char">
      <defs>
        <BodyGradient id={id("body")} p={p} x={78} y={92} r={110} />
        <SheenGradient id={id("sheen")} />
        <linearGradient id={id("leaf")} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor={LEAF.light} />
          <stop offset={0.55} stopColor={LEAF.base} />
          <stop offset={1} stopColor={LEAF.deep} />
        </linearGradient>
      </defs>

      <g transform="translate(100 64)">
        <path d="M0 16V0" stroke={LEAF.deep} strokeWidth={5.5} strokeLinecap="round" />
        <Leaf side="l" angle={la} length={40} fill={url(id("leaf"))} />
        <Leaf side="r" angle={ra} length={46} fill={url(id("leaf"))} />
      </g>

      <path d={BODY} fill={url(id("body"))} />
      <path d="M92 79.5Q100 84 108 79.5" fill="none" stroke={p.deep} strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
      <Sheen id={id("sheen")} x={78} y={98} rx={22} ry={12} arc="M54.5 110A48 40 0 0 1 79.5 88.5" />
      <Face x={100} y={124} gap={19} s={compact ? 1.12 : 1} mood={mood} p={p} blushId={id("blush")} />

      {!compact && (mood === "happy" || mood === "working") ? (
        <Sparkles
          p={p}
          at={[
            [30, 72, 8],
            [172, 150, 6],
          ]}
        />
      ) : null}
    </g>
  );
}

export const sprout: CharacterSpec = { render: Sprout, anchor: { x: 158, y: 68 }, shadow: 50 };
