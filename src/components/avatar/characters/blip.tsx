/**
 * Blip, the robot: a rounded-square head with a glassy screen face, round ear
 * caps and an antenna whose bulb glows. Quick, precise, a little nerdy.
 */
import { ALERT, BodyGradient, Face, GLOW_INK, GlowGradient, Linear, SheenGradient, Sheen, Sparkles, url, type CharacterProps, type CharacterSpec } from "../parts";

function Blip({ p, mood, id, compact }: CharacterProps) {
  const asleep = mood === "sleeping";
  const bulb = mood === "alert" ? ALERT : asleep ? "#9AA0B8" : p.accent;
  const eyeInk = asleep ? "#B9C2E6" : GLOW_INK;
  const progress =
    mood === "working" ? (
      <g>
        <rect x={79} y={124} width={42} height={8} rx={4} fill="#FFFFFF" opacity={0.16} />
        <rect className="bab-av-progress" x={79} y={124} width={42} height={8} rx={4} fill={p.accent} />
      </g>
    ) : undefined;

  return (
    <g className="bab-av-char">
      <defs>
        <BodyGradient id={id("body")} p={p} x={70} y={64} r={130} />
        <SheenGradient id={id("sheen")} />
        <Linear id={id("screen")} x1={100} y1={80} x2={100} y2={146} stops={[[0, "#2D3457"], [1, "#161A35"]]} />
        <Linear id={id("glass")} x1={100} y1={80} x2={100} y2={108} stops={[[0, "#FFFFFF", 0.13], [1, "#FFFFFF", 0]]} />
        <Linear id={id("ear")} x1={0} y1={98} x2={0} y2={128} stops={[[0, p.limbLight], [1, p.limb]]} />
        <GlowGradient id={id("bulb")} color={bulb} strength={0.75} />
        <GlowGradient id={id("eyeglow")} color={p.dark ? p.accent : p.light} strength={0.5} />
      </defs>

      {/* antenna */}
      <g className="bab-av-antenna">
        <path d="M100 60V40" stroke={p.limb} strokeWidth={5.5} strokeLinecap="round" />
        {asleep ? null : <circle className="bab-av-bulb-halo" cx={100} cy={31} r={19} fill={url(id("bulb"))} />}
        <circle className={mood === "alert" ? "bab-av-bulb bab-av-bulb--blink" : "bab-av-bulb"} cx={100} cy={31} r={9} fill={bulb} />
        <circle cx={97} cy={28} r={2.8} fill="#FFFFFF" opacity={0.85} />
      </g>

      {/* feet and ear caps */}
      <g fill={p.limb}>
        <rect x={69} y={152} width={24} height={26} rx={11} />
        <rect x={107} y={152} width={24} height={26} rx={11} />
        <circle cx={38} cy={112} r={15} />
        <circle cx={162} cy={112} r={15} />
      </g>
      <g fill={url(id("ear"))}>
        <circle cx={33} cy={112} r={7} />
        <circle cx={167} cy={112} r={7} />
      </g>

      {/* head */}
      <rect x={38} y={58} width={124} height={108} rx={40} fill={url(id("body"))} />
      <rect x={90} y={55} width={20} height={8} rx={4} fill={p.limb} />
      <Sheen id={id("sheen")} x={66} y={76} rx={26} ry={14} arc="M53 98C53 80 61 70 77 68" />

      {/* screen */}
      <rect x={53} y={80} width={94} height={66} rx={25} fill={url(id("screen"))} />
      <path d="M78 80H122C135.8 80 147 91.2 147 105V108C122 96 86 94 53 108V105C53 91.2 64.2 80 78 80Z" fill={url(id("glass"))} />
      {asleep ? null : (
        <g opacity={0.9}>
          <circle cx={82} cy={106} r={18} fill={url(id("eyeglow"))} />
          <circle cx={118} cy={106} r={18} fill={url(id("eyeglow"))} />
        </g>
      )}
      <Face x={100} y={107} gap={18} s={0.92 * (compact ? 1.1 : 1)} mood={mood} p={p} blushId={id("blush")} ink={eyeInk} shine={null} mouthDy={16} mouth={progress} />

      {!compact && (mood === "happy" || mood === "working") ? (
        <Sparkles
          p={p}
          at={[
            [30, 54, 8],
            [172, 154, 6],
          ]}
        />
      ) : null}
    </g>
  );
}

export const blip: CharacterSpec = { render: Blip, anchor: { x: 156, y: 50 }, shadow: 50 };
