"use client";
import * as React from "react";
import { Ban, Check, Hand } from "lucide-react";
import { TRUST, TRUST_LEVELS, type TrustLevel } from "@/lib/trust";
import { cn } from "@/lib/utils";

/** Segment colors, from read-only (cool) to full autopilot (brand violet). */
const COLORS: Record<TrustLevel, string> = {
  look: "#3B82F6",
  ask: "#2FCB94",
  trusted: "#FFB020",
  full: "#7C5CFF",
};

const CX = 160;
const CY = 158;
const R = 128;
const SWEEP = 45;
const GAP = 2.5;

function polar(angleDeg: number, r = R) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

/** Arc from angle a0 to a1 (degrees, counter-clockwise from the right), drawn left to right. */
function arc(a0: number, a1: number) {
  const s = polar(a0);
  const e = polar(a1);
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function Gauge({ level }: { level: TrustLevel }) {
  const index = TRUST_LEVELS.indexOf(level);
  const needle = -67.5 + index * 45;
  return (
    <svg viewBox="0 0 320 190" className="w-full max-w-[340px]" aria-hidden="true">
      <path d={arc(180, 0)} fill="none" stroke="var(--muted)" strokeWidth={30} strokeLinecap="round" />
      {TRUST_LEVELS.map((t, i) => {
        const start = 180 - i * SWEEP - (i === 0 ? 0 : GAP / 2);
        const end = 180 - (i + 1) * SWEEP + (i === TRUST_LEVELS.length - 1 ? 0 : GAP / 2);
        const on = i <= index;
        return (
          <path
            key={t}
            d={arc(start, end)}
            fill="none"
            stroke={on ? COLORS[t] : "var(--border)"}
            strokeWidth={22}
            strokeLinecap={i === 0 || i === TRUST_LEVELS.length - 1 ? "round" : "butt"}
            style={{ transition: "stroke 0.4s ease" }}
          />
        );
      })}
      {TRUST_LEVELS.map((t, i) => {
        const p = polar(180 - i * SWEEP - SWEEP / 2, R - 42);
        return (
          <text key={t} x={p.x} y={p.y + 6} textAnchor="middle" fontSize={17} opacity={i <= index ? 1 : 0.4} style={{ transition: "opacity 0.3s" }}>
            {TRUST[t].emoji}
          </text>
        );
      })}
      <g style={{ transform: `rotate(${needle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 0.7s cubic-bezier(0.34, 1.45, 0.5, 1)" }}>
        <path d={`M ${CX - 5} ${CY} L ${CX} ${CY - R + 66} L ${CX + 5} ${CY} Z`} fill="var(--foreground)" />
      </g>
      <circle cx={CX} cy={CY} r={15} fill="var(--card)" stroke="var(--foreground)" strokeWidth={4} />
      <circle cx={CX} cy={CY} r={5} fill={COLORS[level]} style={{ transition: "fill 0.4s" }} />
    </svg>
  );
}

function List({ title, icon, items, empty, tone }: { title: string; icon: React.ReactNode; items: string[]; empty: string; tone: "success" | "warning" | "danger" }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background-2/60 p-4">
      <div className="flex items-center gap-2 text-sm font-bold">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full [&_svg]:size-3.5",
            tone === "success" && "bg-success-soft text-success",
            tone === "warning" && "bg-warning-soft text-warning",
            tone === "danger" && "bg-danger-soft text-danger",
          )}
        >
          {icon}
        </span>
        {title}
      </div>
      {items.length ? (
        <ul className="flex flex-col gap-2 text-sm leading-snug">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function TrustDial({ initial = "full" }: { initial?: TrustLevel }) {
  const [level, setLevel] = React.useState<TrustLevel>(initial);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const def = TRUST[level];

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const j = (i + dir + TRUST_LEVELS.length) % TRUST_LEVELS.length;
    setLevel(TRUST_LEVELS[j]);
    refs.current[j]?.focus();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-7">
        <Gauge level={level} />
        <div role="radiogroup" aria-label="Trust level" className="mt-5 grid w-full grid-cols-2 gap-2">
          {TRUST_LEVELS.map((t, i) => {
            const active = t === level;
            return (
              <button
                key={t}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setLevel(t)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-3 text-left transition",
                  active ? "border-transparent bg-primary-soft ring-2 ring-primary" : "border-border bg-card hover:bg-muted",
                )}
              >
                <span className="font-semibold leading-snug">
                  <span aria-hidden="true">{TRUST[t].emoji}</span> {TRUST[t].name}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">{TRUST[t].short}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        key={level}
        className={cn(
          "flex animate-fade-up flex-col rounded-3xl border bg-card p-5 shadow-soft sm:p-7",
          level === "full" ? "border-primary/40 ring-4 ring-primary/10" : "border-border",
        )}
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl text-2xl" style={{ background: `color-mix(in oklab, ${COLORS[level]} 16%, transparent)` }} aria-hidden="true">
            {def.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-2xl font-bold tracking-tight">{def.name}</h3>
            <p className="text-sm text-muted-foreground">{def.short}</p>
          </div>
        </div>
        <p className="mt-4 text-[15px] leading-relaxed">{def.long}</p>
        {def.dailyActions > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            By default, up to <span className="font-semibold text-foreground">{def.dailyActions} actions a day</span> without asking. After that, it asks you.
          </p>
        ) : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <List title="Does on its own" icon={<Check />} items={def.can} empty="Nothing yet." tone="success" />
          <List title="Asks you first" icon={<Hand />} items={def.asks} empty="Nothing to ask: it never acts." tone="warning" />
          <List title="Never" icon={<Ban />} items={def.never} empty="—" tone="danger" />
        </div>
      </div>
    </div>
  );
}
