"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { JOBS } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { SettingsSection, UnsavedDot, useApiErrorToast } from "./ui";

const MAX = 12;

export function JobsSection({ botId, botName, initial }: { botId: string; botName: string; initial: string[] }) {
  const onError = useApiErrorToast();
  const [saved, setSaved] = React.useState(initial);
  const [jobs, setJobs] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const dirty = [...jobs].sort().join() !== [...saved].sort().join();

  const toggle = (id: string) =>
    setJobs((cur) => {
      if (cur.includes(id)) return cur.filter((j) => j !== id);
      if (cur.length >= MAX) {
        toast(`Pick up to ${MAX}.`);
        return cur;
      }
      return [...cur, id];
    });

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/bots/${botId}`, { method: "PATCH", body: { jobs } });
      setSaved(jobs);
      toast.success("Saved", { description: jobs.length ? `${botName} will focus on ${jobs.length === 1 ? "that" : "these"}.` : undefined });
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="jobs"
      icon={Target}
      title="What it helps with"
      description={`Pick what matters to you. ${botName} leans into these and suggests ideas around them.`}
      footer={
        <>
          <UnsavedDot show={dirty} />
          {dirty ? (
            <Button variant="ghost" onClick={() => setJobs(saved)} disabled={saving}>
              Discard
            </Button>
          ) : null}
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
        </>
      }
    >
      <div role="group" aria-label="What it helps with" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
        {JOBS.map((j) => {
          const on = jobs.includes(j.id);
          return (
            <button
              key={j.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(j.id)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition",
                on ? "border-primary bg-primary-soft/60" : "border-border bg-card hover:border-foreground/20 hover:bg-muted/40",
              )}
            >
              <span className="text-xl leading-none" aria-hidden>
                {j.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{j.label}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{j.blurb}</span>
              </span>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border transition",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
                aria-hidden
              >
                {on ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        New jobs don&apos;t connect apps on their own. Add the apps you want in{" "}
        <Link href={`/app/bots/${botId}/tools`} className="font-semibold text-primary hover:underline">
          Apps &amp; trust
        </Link>
        .
      </p>
    </SettingsSection>
  );
}
