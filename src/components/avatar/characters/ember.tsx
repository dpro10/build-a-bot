/**
 * Ember, the spark: a round-bottomed flame spirit with a glowing core, a main tip
 * and a smaller lick that flicker independently of its face. Bold, fast, decisive.
 */
import type { AvatarMood } from "@/lib/avatars";
import { BodyGradient, Face, INK, Radial, SheenGradient, Sheen, Sparkles, mix, phase, sparklePath, url, type CharacterProps, type CharacterSpec } from "../parts";

const FLAME =
  "M100 172C72 172 50 151 50 126C50 102 55 82 59 58C69 67 77 77 82 88C84 66 92 44 104 26C124 48 150 80 150 126C150 151 128 172 100 172Z";
const CORE = "M100 166C79 166 64 151 64 131C64 109 80 96 98 74C116 96 136 110 136 131C136 151 121 166 100 166Z";

/** Flame proportions per mood (scale around the base): taller when fired up, low and round when asleep. */
const SCALE: Record<AvatarMood, readonly [sx: number, sy: number]> = {
  idle: [1, 1],
  happy: [1.03, 1.05],
  thinking: [1, 0.98],
  working: [1.02, 1.07],
  sleeping: [1.02, 0.84],
  alert: [0.98, 1.08],
};

function Ember({ p, mood, id, compact }: CharacterProps) {
  const [sx, sy] = SCALE[mood];
  const base = 172;
  const t = `translate(100 ${base}) scale(${sx} ${sy}) translate(-100 ${-base})`;
  const faceY = base - (base - 130) * sy;
  const lively = mood !== "sleeping";
  // The face sits on the bright core, so it always uses dark ink; dark palettes get an accent-colored glow.
  const core = p.dark ? p.accent : p.light;
  return (
    <g className="bab-av-char">
      <defs>
        <BodyGradient id={id("body")} p={p} x={86} y={70} r={124} />
        <Radial id={id("core")} x={100} y={140} r={46} stops={[[0, mix(core, "#FFFFFF", 0.75)], [0.6, mix(core, "#FFFFFF", 0.35)], [1, core]]} />
        <SheenGradient id={id("sheen")} />
      </defs>

      <g transform={t}>
        <g className="bab-av-flame">
          <path d={FLAME} fill={url(id("body"))} />
        </g>
        <g className="bab-av-core">
          <path d={CORE} fill={url(id("core"))} opacity={0.92} />
        </g>
        <Sheen id={id("sheen")} x={74} y={102} rx={16} ry={9} rotate={-55} arc="M59 122C59 110 62 100 67 90" />
      </g>

      <Face x={100} y={faceY} gap={18} s={compact ? 1.1 : 1} mood={mood} p={p} blushId={id("blush")} ink={INK} shine="#FFFFFF" />

      {lively && !compact ? (
        <g className="bab-av-sparks" fill={p.accent}>
          <path className="bab-av-spark" d={sparklePath(144, 42, 6.5)} />
          <path className="bab-av-spark" d={sparklePath(58, 40, 5)} style={phase(1.1)} />
          {mood === "working" || mood === "happy" ? <path className="bab-av-spark" d={sparklePath(160, 88, 4.5)} style={phase(0.6)} /> : null}
        </g>
      ) : null}
      {!compact && (mood === "happy" || mood === "working") ? <Sparkles p={p} at={[[32, 92, 7]]} /> : null}
    </g>
  );
}

export const ember: CharacterSpec = { render: Ember, anchor: { x: 162, y: 54 }, shadow: 46 };
