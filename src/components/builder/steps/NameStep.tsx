"use client";
import * as React from "react";
import { Dices } from "lucide-react";
import { AVATARS, type AvatarId } from "@/lib/avatars";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { nameError } from "../state";
import { StepHeading } from "./StepHeading";

export function NameStep({
  avatar,
  name,
  ownerName,
  onName,
  onOwnerName,
  onSubmit,
  onTyping,
}: {
  avatar: AvatarId;
  name: string;
  ownerName: string;
  onName: (v: string) => void;
  onOwnerName: (v: string) => void;
  onSubmit: () => void;
  onTyping: (typing: boolean) => void;
}) {
  const a = AVATARS[avatar];
  const [touched, setTouched] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const error = touched ? nameError(name) : null;
  const typingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const ideas = React.useMemo(() => a.nameIdeas.filter((n) => n !== a.character).slice(0, 6), [a]);

  const surprise = () => {
    const pool = a.nameIdeas.filter((n) => n.toLowerCase() !== name.trim().toLowerCase());
    onName(pool[Math.floor(Math.random() * pool.length)]);
    setTouched(true);
    pulse();
  };

  const pulse = () => {
    onTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 900);
  };

  return (
    <div className="flex flex-col gap-7">
      <StepHeading title="Name it" subtitle={`Give your ${a.species} a name of its own. It'll introduce itself with it everywhere.`} />
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!nameError(name)) onSubmit();
        }}
      >
        <Label htmlFor="bot-name" className="sr-only">
          Bot name
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={inputRef}
            id="bot-name"
            value={name}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            placeholder={`e.g. ${a.nameIdeas[1] ?? a.character}`}
            onChange={(e) => {
              onName(e.target.value);
              pulse();
            }}
            onBlur={() => setTouched(Boolean(name))}
            aria-invalid={Boolean(error)}
            aria-describedby="bot-name-hint"
            className={cn("h-16 rounded-3xl px-6 font-display text-2xl font-semibold", error && "border-danger focus:border-danger focus:ring-danger/15")}
          />
          <Button type="button" variant="outline" size="xl" onClick={surprise} className="h-16 shrink-0">
            <Dices /> Surprise me
          </Button>
        </div>
        <FieldHint id="bot-name-hint" className={cn("min-h-4 text-sm", error && "text-danger")}>
          {error ?? `${name.trim().length}/32`}
        </FieldHint>
        <div className="flex flex-wrap gap-2" aria-label="Name ideas">
          {ideas.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onName(n);
                setTouched(true);
                pulse();
              }}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                name.trim() === n ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </form>

      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor="owner-name">What should {name.trim() || "it"} call you?</Label>
        <Input id="owner-name" value={ownerName} maxLength={60} autoComplete="given-name" placeholder="Your first name (optional)" onChange={(e) => onOwnerName(e.target.value)} />
      </div>
    </div>
  );
}
