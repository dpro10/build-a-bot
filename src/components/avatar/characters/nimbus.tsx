/**
 * Nimbus, the cloud: a soft three-puff cloud with a flat, calm base that drifts
 * above its shadow. Calm, organized, unflappable.
 */
import { BodyGradient, Face, SheenGradient, Sheen, Sparkles, phase, url, type CharacterProps, type CharacterSpec } from "../parts";

const CLOUD = "M54 162A26 26 0 0 1 38.48 115.14A28 28 0 0 1 66.48 82A38 38 0 0 1 141.35 81A27 27 0 0 1 164.76 120.82A24 24 0 0 1 148 162Z";

function Nimbus({ p, mood, id, compact }: CharacterProps) {
  return (
    <g className="bab-av-char">
      <defs>
        <BodyGradient id={id("body")} p={p} x={78} y={62} r={140} />
        <SheenGradient id={id("sheen")} />
      </defs>
      <path d={CLOUD} fill={url(id("body"))} />
      <ellipse cx={56} cy={98} rx={12} ry={7} fill={url(id("sheen"))} opacity={0.7} transform="rotate(-35 56 98)" />
      <Sheen id={id("sheen")} x={84} y={70} rx={24} ry={12} arc="M76.75 78.08A29 29 0 0 1 94.08 60.75" />
      <Face x={100} y={118} gap={19.5} s={compact ? 1.18 : 1.06} mood={mood} p={p} blushId={id("blush")} />
      {!compact && mood === "working" ? (
        <g fill="none" stroke={p.dark ? p.light : p.base} strokeWidth={4} strokeLinecap="round" opacity={0.75}>
          <path className="bab-av-gust" d="M12 112h14" />
          <path className="bab-av-gust" d="M6 128h18" style={phase(0.45)} />
        </g>
      ) : null}
      {!compact && (mood === "happy" || mood === "working") ? (
        <Sparkles
          p={p}
          at={[
            [30, 64, 8],
            [176, 150, 6],
          ]}
        />
      ) : null}
    </g>
  );
}

export const nimbus: CharacterSpec = { render: Nimbus, anchor: { x: 158, y: 58 }, shadow: 50 };
