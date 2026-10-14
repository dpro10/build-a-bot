"use client";
import * as React from "react";
import { Receipt } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { AVATARS, AVATAR_IDS, COLORWAYS, COLORWAY_IDS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import { cn } from "@/lib/utils";

type ChannelKey = "slack" | "telegram" | "sms" | "voice" | "email";

type Scene = {
  name: string;
  channel: ChannelKey;
  trust: { emoji: string; label: string };
  text: string;
  activity: string;
};

/** One short, honest moment per character: things a bot here can really do. */
const SCENES: Record<AvatarId, Scene> = {
  blip: {
    name: "Pixel",
    channel: "slack",
    trust: { emoji: "🤝", label: "Trusted helper" },
    text: "Two PRs are waiting on your review, and CI is red on main. Want me to open an issue for the flaky test?",
    activity: "Checked 14 GitHub notifications",
  },
  nimbus: {
    name: "Misty",
    channel: "telegram",
    trust: { emoji: "✋", label: "Ask me first" },
    text: "Good morning! Three emails need you today. I drafted replies to two. Want a look before anything goes out?",
    activity: "2 drafts waiting for your OK",
  },
  sprout: {
    name: "Fern",
    channel: "sms",
    trust: { emoji: "🤝", label: "Trusted helper" },
    text: "Day 12 of your reading streak! Want your chapter 4 quiz tonight at 8:30?",
    activity: "Streak saved to your Habits note",
  },
  ember: {
    name: "Blaze",
    channel: "voice",
    trust: { emoji: "🚀", label: "Full faith" },
    text: "Saturday's sorted: pharmacy, groceries, then the post office. I just texted you the fastest route.",
    activity: "Route sent by text · receipt saved",
  },
  otto: {
    name: "Inkwell",
    channel: "email",
    trust: { emoji: "👀", label: "Look only" },
    text: "I read nine reviews of those three laptops. Short version: get the one with 16 GB. Sources are in the email.",
    activity: "Cited 9 sources",
  },
};

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  slack: "in Slack",
  telegram: "on Telegram",
  sms: "by text",
  voice: "on a call",
  email: "by email",
};

const ROTATE_MS = 6500;
const TYPING_MS = 1100;

export function HeroStage({ channelIcons }: { channelIcons: Record<ChannelKey, React.ReactNode> }) {
  const [avatar, setAvatar] = React.useState<AvatarId>("blip");
  const [color, setColor] = React.useState<ColorwayId>(AVATARS.blip.defaultColor);
  const [typing, setTyping] = React.useState(false);
  const [auto, setAuto] = React.useState(true);
  const [visible, setVisible] = React.useState(true);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const scene = SCENES[avatar];
  const def = AVATARS[avatar];
  const c = COLORWAYS[color];

  const show = React.useCallback((next: AvatarId, nextColor?: ColorwayId) => {
    setAvatar(next);
    setColor(nextColor ?? AVATARS[next].defaultColor);
    setTyping(true);
  }, []);

  // The bot "types" for a moment after every switch.
  React.useEffect(() => {
    if (!typing) return;
    const t = window.setTimeout(() => setTyping(false), TYPING_MS);
    return () => window.clearTimeout(t);
  }, [typing, avatar]);

  // No autoplay for people who prefer less motion.
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAuto(false);
  }, []);

  // Only cycle while the stage is on screen.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const avatarRef = React.useRef(avatar);
  React.useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  React.useEffect(() => {
    if (!auto || !visible) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const next = AVATAR_IDS[(AVATAR_IDS.indexOf(avatarRef.current) + 1) % AVATAR_IDS.length];
      show(next);
    }, ROTATE_MS);
    return () => window.clearInterval(t);
  }, [auto, visible, show]);

  const pick = (id: AvatarId) => {
    setAuto(false);
    if (id !== avatar) show(id);
  };
  const paint = (id: ColorwayId) => {
    setAuto(false);
    setColor(id);
  };

  const onPickerKey = (e: React.KeyboardEvent, list: readonly string[], current: string, apply: (v: string) => void) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = list[(list.indexOf(current) + dir + list.length) % list.length];
    apply(next);
    const btn = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-value="${next}"]`);
    btn?.focus();
  };

  return (
    <div ref={rootRef} className="relative mx-auto w-full max-w-[540px] lg:mx-0 lg:ml-auto">
      {/* Stage */}
      <div className="relative overflow-hidden rounded-[2.25rem] border border-border bg-card shadow-lift">
        <div
          aria-hidden="true"
          className="absolute inset-0 transition-[background] duration-700"
          style={{
            background: `radial-gradient(85% 65% at 50% 92%, color-mix(in oklab, ${c.base} 30%, transparent) 0%, transparent 72%), radial-gradient(45% 40% at 88% 6%, color-mix(in oklab, ${c.accent} 26%, transparent) 0%, transparent 70%), radial-gradient(40% 40% at 6% 18%, color-mix(in oklab, ${c.light} 30%, transparent) 0%, transparent 70%)`,
          }}
        />
        <div aria-hidden="true" className="dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_50%_45%,#000,transparent)]" />

        <div className="relative flex flex-col items-center px-5 pt-5 pb-14 sm:px-7 sm:pt-6 sm:pb-16">
          {/* Name tag + trust level */}
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card/85 py-1 pr-3 pl-1 shadow-soft backdrop-blur">
              <span className="flex size-7 items-center justify-center rounded-full" style={{ background: `color-mix(in oklab, ${c.base} 20%, transparent)` }}>
                <Avatar avatar={avatar} color={color} size={26} animated={false} title={`${scene.name}, ${def.character} the ${def.species}`} />
              </span>
              <span className="truncate text-sm font-semibold">{scene.name}</span>
              <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground min-[400px]:inline">AI assistant</span>
            </div>
            <div className="shrink-0 rounded-full border border-border bg-card/85 px-3 py-1 text-xs font-semibold shadow-soft backdrop-blur">
              <span aria-hidden="true">{scene.trust.emoji}</span> {scene.trust.label}
            </div>
          </div>

          {/* Speech bubble */}
          <div className="relative mt-6 w-full max-w-[350px] sm:mt-7">
            <div className="relative rounded-[1.4rem] border border-border bg-card px-4 py-3.5 shadow-lift">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="inline-flex shrink-0">{channelIcons[scene.channel]}</span>
                <span>
                  {scene.name} {CHANNEL_LABEL[scene.channel]}
                </span>
                <span aria-hidden="true">·</span>
                <span>now</span>
              </div>
              <div className="min-h-[4.5rem] text-[15px] leading-snug sm:min-h-[4.25rem]" aria-live={auto ? "off" : "polite"}>
                {typing ? (
                  <span className="mk-dots inline-flex items-center gap-1 pt-2 text-muted-foreground" aria-label={`${scene.name} is typing`}>
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <p key={avatar} className="animate-fade-up">
                    {scene.text}
                  </p>
                )}
              </div>
            </div>
            {/* Tail */}
            <span aria-hidden="true" className="absolute -bottom-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] border-r border-b border-border bg-card" />
          </div>

          {/* The bot */}
          <div className="relative mt-3 flex flex-col items-center">
            <Avatar
              key={`${avatar}-${color}`}
              avatar={avatar}
              color={color}
              size={230}
              mood={typing ? "thinking" : "happy"}
              className="h-auto w-[160px] animate-pop sm:w-[196px]"
              title={`${scene.name}, ${def.character} the ${def.species}`}
            />
            <div className="-mt-1 text-center">
              <div className="font-display text-2xl font-bold tracking-tight">{scene.name}</div>
              <div className="text-sm text-muted-foreground">
                {def.character} the {def.species} · {def.traits.join(", ").toLowerCase()}
              </div>
            </div>
            {/* Receipt chip */}
            <div
              key={scene.activity}
              className="mt-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-medium shadow-soft backdrop-blur"
            >
              <Receipt className="size-3.5 text-success" aria-hidden="true" />
              <span className="text-muted-foreground">{scene.activity}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Picker */}
      <div className="relative z-10 mx-auto -mt-5 flex w-fit max-w-full flex-col items-center gap-2.5 rounded-[1.6rem] border border-border bg-card/95 px-3 py-3 shadow-lift backdrop-blur sm:-mt-6 sm:flex-row sm:gap-3 sm:rounded-full sm:py-2 sm:pr-4 sm:pl-2">
        <div
          role="radiogroup"
          aria-label="Pick a face"
          className="flex items-center gap-1"
          onKeyDown={(e) => onPickerKey(e, AVATAR_IDS, avatar, (v) => pick(v as AvatarId))}
        >
          {AVATAR_IDS.map((id) => {
            const active = id === avatar;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                data-value={id}
                aria-label={`${AVATARS[id].character} the ${AVATARS[id].species}`}
                onClick={() => pick(id)}
                className={cn(
                  "flex size-11 items-center justify-center rounded-full transition duration-200",
                  active ? "scale-105 bg-primary-soft ring-2 ring-primary" : "hover:-translate-y-0.5 hover:bg-muted",
                )}
              >
                <Avatar avatar={id} size={36} animated={false} title={AVATARS[id].character} />
              </button>
            );
          })}
        </div>
        <span className="hidden h-7 w-px bg-border sm:block" aria-hidden="true" />
        <div
          role="radiogroup"
          aria-label="Colorway"
          className="flex items-center gap-1.5"
          onKeyDown={(e) => onPickerKey(e, COLORWAY_IDS, color, (v) => paint(v as ColorwayId))}
        >
          {COLORWAY_IDS.map((id) => {
            const active = id === color;
            const cw = COLORWAYS[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                data-value={id}
                aria-label={`${cw.name} colorway`}
                title={cw.name}
                onClick={() => paint(id)}
                className={cn(
                  "size-[22px] rounded-full ring-offset-2 ring-offset-card transition duration-200",
                  active ? "scale-110 ring-2 ring-foreground/70" : "hover:scale-110",
                )}
                style={{ background: `linear-gradient(135deg, ${cw.light}, ${cw.base} 55%, ${cw.deep})` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
