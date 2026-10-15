"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Dices, Palette, Plus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { AVATARS, AVATAR_IDS, COLORWAYS, COLORWAY_IDS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import { FieldGroup, SettingsSection, UnsavedDot, useApiErrorToast } from "./ui";
import { radioKeyDown, radioTabIndex } from "@/components/bot/activity/radio-keys";

type Verbosity = "brief" | "balanced" | "detailed";

export type LookValues = {
  name: string;
  avatar: AvatarId;
  color: ColorwayId;
  instructions: string;
  verbosity: Verbosity;
  emoji: boolean;
  tone: string;
};

const EXAMPLES = [
  "Call me by my first name.",
  "Keep answers under three sentences unless I ask for more.",
  "Write emails in my voice: short, warm, no corporate fluff.",
  "Always check with me before booking or buying anything.",
  "I'm vegetarian and I live in Austin, TX.",
];

export function LookSection({ botId, initial, badge = "AI assistant" }: { botId: string; initial: LookValues; badge?: string }) {
  const router = useRouter();
  const onError = useApiErrorToast();
  const [saved, setSaved] = React.useState(initial);
  const [v, setV] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const def = AVATARS[v.avatar];
  const set = <K extends keyof LookValues>(k: K, value: LookValues[K]) => setV((cur) => ({ ...cur, [k]: value }));

  const surprise = () => {
    const ideas = def.nameIdeas.filter((n) => n !== v.name);
    set("name", ideas[Math.floor(Math.random() * ideas.length)] ?? def.character);
  };

  const addExample = (text: string) => {
    const cur = v.instructions.trimEnd();
    if (cur.includes(text)) return;
    set("instructions", (cur ? `${cur}\n${text}` : text).slice(0, 4000));
  };

  const save = async () => {
    const name = v.name.trim();
    if (!name) return toast.error("Give it a name.");
    // Same rule as the builder: the bot's name (and the handles made from it) stays brand-free.
    if (/build[\s-]*a[\s-]*bot/i.test(name)) return toast.error("Pick a name that isn't the product's name.");
    setSaving(true);
    try {
      await api(`/api/bots/${botId}`, {
        method: "PATCH",
        body: {
          name,
          avatar: v.avatar,
          color: v.color,
          instructions: v.instructions,
          vibe: { verbosity: v.verbosity, emoji: v.emoji, tone: v.tone.trim() },
        },
      });
      const next = { ...v, name, tone: v.tone.trim() };
      setSaved(next);
      setV(next);
      toast.success("Saved", { description: `${name} looks and sounds just right.` });
      if (name !== saved.name || v.avatar !== saved.avatar || v.color !== saved.color) router.refresh();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="look"
      icon={Palette}
      title="Look & personality"
      description="How it looks, what it's called, and how it talks to you."
      footer={
        <>
          <UnsavedDot show={dirty} />
          {dirty ? (
            <Button variant="ghost" onClick={() => setV(saved)} disabled={saving}>
              Discard
            </Button>
          ) : null}
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div
            className="relative flex w-full shrink-0 flex-col items-center gap-2 self-center rounded-3xl border border-border px-6 pt-4 pb-4 sm:w-52"
            style={{ background: `radial-gradient(circle at 50% 38%, color-mix(in oklab, ${COLORWAYS[v.color].base} 24%, transparent), transparent 72%)` }}
          >
            <Avatar avatar={v.avatar} color={v.color} size={124} mood="happy" />
            <span className="max-w-full truncate font-display text-lg font-bold">{v.name.trim() || def.character}</span>
            <Badge tone="outline" className="bg-card/80">
              {badge}
            </Badge>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <FieldGroup label="Name" htmlFor="look-name" hint="Shown everywhere you talk to it. It always says it's an AI.">
              <div className="flex gap-2">
                <Input id="look-name" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={32} autoComplete="off" className="flex-1" />
                <Button type="button" variant="outline" size="icon" className="size-12 shrink-0" onClick={surprise} aria-label="Suggest a name" title="Suggest a name">
                  <Dices className="!size-5" />
                </Button>
              </div>
            </FieldGroup>
            <FieldGroup label="Colors">
              <div role="radiogroup" aria-label="Colors" className="flex flex-wrap gap-1.5 sm:gap-2">
                {COLORWAY_IDS.map((id, i) => {
                  const c = COLORWAYS[id];
                  const on = v.color === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={radioTabIndex(on, i, COLORWAY_IDS.includes(v.color))}
                      onKeyDown={radioKeyDown}
                      aria-label={c.name}
                      title={c.name}
                      onClick={() => set("color", id)}
                      className={cn(
                        "relative size-8 rounded-full transition hover:scale-110 sm:size-9",
                        on ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "ring-1 ring-black/10",
                      )}
                      style={{ background: `linear-gradient(140deg, ${c.light}, ${c.base} 55%, ${c.deep})` }}
                    >
                      <span className="absolute right-0.5 bottom-0.5 size-2.5 rounded-full ring-2 ring-white/80" style={{ background: c.accent }} aria-hidden />
                    </button>
                  );
                })}
              </div>
            </FieldGroup>
          </div>
        </div>

        <FieldGroup label="Character">
          <div role="radiogroup" aria-label="Character" className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {AVATAR_IDS.map((id, i) => {
              const a = AVATARS[id];
              const on = v.avatar === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={radioTabIndex(on, i, AVATAR_IDS.includes(v.avatar))}
                  onKeyDown={radioKeyDown}
                  onClick={() => set("avatar", id)}
                  title={a.tagline}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1 rounded-2xl border px-1 py-2 transition sm:p-2.5 sm:pb-3",
                    on ? "border-primary bg-primary-soft/60 ring-4 ring-primary/10" : "border-border bg-card hover:border-foreground/20 hover:bg-muted/40",
                  )}
                >
                  <Avatar avatar={id} color={v.color} size={64} mood={on ? "happy" : "idle"} animated={on} className="h-auto w-full max-w-16" />
                  <span className="text-xs font-semibold sm:text-sm">{a.character}</span>
                  <span className="hidden text-[11px] leading-tight text-muted-foreground sm:block">{a.traits.join(" · ")}</span>
                </button>
              );
            })}
          </div>
        </FieldGroup>

        <FieldGroup label="Custom instructions" htmlFor="look-instructions">
          <Textarea
            id="look-instructions"
            value={v.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            maxLength={4000}
            rows={5}
            placeholder="Write emails in my voice: short and warm. Never book anything without asking me."
            className="text-[15px] leading-relaxed"
          />
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>Anything it should always keep in mind: how to talk to you, what matters most, what to avoid.</span>
            <span className="shrink-0 tabular-nums">{v.instructions.length}/4000</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="mr-0.5 text-xs font-semibold text-muted-foreground">Ideas:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => addExample(ex)}
                className="inline-flex max-w-full items-start gap-1 rounded-2xl border border-dashed border-border px-2.5 py-1 text-left text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                <Plus className="mt-0.5 size-3 shrink-0" aria-hidden /> <span>{ex}</span>
              </button>
            ))}
          </div>
        </FieldGroup>

        <div className="grid gap-5 sm:grid-cols-2">
          <FieldGroup label="How much it says" hint={v.verbosity === "brief" ? "Short and to the point." : v.verbosity === "detailed" ? "More detail and context when it helps." : "Concise, more when the task needs it."}>
            <Segmented
              aria-label="How much it says"
              value={v.verbosity}
              onChange={(x) => set("verbosity", x)}
              options={[
                { value: "brief", label: "Brief" },
                { value: "balanced", label: "Balanced" },
                { value: "detailed", label: "Detailed" },
              ]}
              className="self-start"
            />
          </FieldGroup>
          <FieldGroup label="Emoji" hint={v.emoji ? "A little emoji now and then." : "Plain text, no emoji."}>
            <label className="flex items-center gap-3 self-start">
              <Switch checked={v.emoji} onCheckedChange={(x) => set("emoji", x)} aria-label="Use emoji" />
              <span className="text-sm">{v.emoji ? "On" : "Off"}</span>
            </label>
          </FieldGroup>
        </div>
        <FieldGroup label="Tone" htmlFor="look-tone" hint={`In a few words. ${def.character}'s natural tone is “${def.personality.tone}”.`}>
          <Input id="look-tone" value={v.tone} onChange={(e) => set("tone", e.target.value)} maxLength={80} placeholder={def.personality.tone} autoComplete="off" />
        </FieldGroup>
      </div>
    </SettingsSection>
  );
}
