"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { AVATAR_IDS, AVATARS, COLORWAY_IDS, COLORWAYS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import { StepHeading } from "./StepHeading";

export function FaceStep({ avatar, color, onAvatar, onColor }: { avatar: AvatarId; color: ColorwayId; onAvatar: (id: AvatarId) => void; onColor: (id: ColorwayId) => void }) {
  const def = AVATARS[avatar];
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Pick a face" subtitle="Five originals, each with its own personality. You can change looks anytime." />
      <div role="radiogroup" aria-label="Character" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {AVATAR_IDS.map((id) => {
          const a = AVATARS[id];
          const active = id === avatar;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onAvatar(id)}
              className={cn(
                "group relative flex flex-col items-center rounded-3xl border bg-card px-2 pt-3 pb-3.5 transition",
                active ? "border-primary shadow-glow ring-2 ring-primary/25" : "border-border hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-soft",
              )}
            >
              {active ? (
                <span className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : null}
              <Avatar avatar={id} color={active ? color : a.defaultColor} size={104} animated={active} mood={active ? "happy" : "idle"} />
              <span className="font-display text-base font-semibold">{a.character}</span>
              <span className="text-xs text-muted-foreground capitalize">{a.species}</span>
            </button>
          );
        })}
      </div>

      <div key={avatar} className="animate-fade-up rounded-3xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-display text-lg font-semibold">
            {def.character} the {def.species}
          </span>
          <span className="text-muted-foreground">{def.tagline}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {def.traits.map((t) => (
            <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
              {t}
            </span>
          ))}
          <span className="px-1 py-1 text-xs text-muted-foreground">Great at {def.goodAt.join(", ")}</span>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-display text-lg font-semibold">Colors</span>
          <span className="text-sm text-muted-foreground">{COLORWAYS[color].name}</span>
        </div>
        <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2.5">
          {COLORWAY_IDS.map((id) => {
            const c = COLORWAYS[id];
            const active = id === color;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={c.name}
                title={c.name}
                onClick={() => onColor(id)}
                className={cn("relative size-11 rounded-full transition hover:scale-105", active ? "ring-[3px] ring-foreground ring-offset-2 ring-offset-background" : "ring-1 ring-black/10")}
                style={{ background: `radial-gradient(circle at 35% 30%, ${c.light}, ${c.base} 55%, ${c.deep})` }}
              >
                <span className="absolute right-0.5 bottom-0.5 size-3 rounded-full ring-2 ring-white/80" style={{ background: c.accent }} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
