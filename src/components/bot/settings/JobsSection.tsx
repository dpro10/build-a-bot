"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { onRadioGroupKeyDown, radioTabIndex } from "@/components/builder/radio-group";
import { JOBS } from "@/lib/jobs";
import { ROLES, isRoleId, type RoleId } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { SettingsSection, UnsavedDot, useApiErrorToast } from "./ui";

const MAX = 12;

const ROLE_OPTIONS: { id: RoleId | null; label: string; emoji: string }[] = [{ id: null, label: "General assistant", emoji: "✨" }, ...ROLES];

export function JobsSection({ botId, botName, initial, initialRole }: { botId: string; botName: string; initial: string[]; initialRole: string | null }) {
  const router = useRouter();
  const onError = useApiErrorToast();
  const startRole = isRoleId(initialRole) ? initialRole : null;
  const [saved, setSaved] = React.useState({ jobs: initial, role: startRole });
  const [jobs, setJobs] = React.useState(initial);
  const [role, setRole] = React.useState<RoleId | null>(startRole);
  const [saving, setSaving] = React.useState(false);
  const dirty = [...jobs].sort().join() !== [...saved.jobs].sort().join() || role !== saved.role;

  const toggle = (id: string) => {
    // The toast stays out of the state updater (React may run updaters twice).
    if (!jobs.includes(id) && jobs.length >= MAX) {
      toast(`Pick up to ${MAX}.`);
      return;
    }
    setJobs((cur) => (cur.includes(id) ? cur.filter((j) => j !== id) : cur.length >= MAX ? cur : [...cur, id]));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/bots/${botId}`, { method: "PATCH", body: { jobs, role } });
      const roleChanged = role !== saved.role;
      setSaved({ jobs, role });
      // The header's "AI tutor" badge follows the role.
      if (roleChanged) router.refresh();
      toast.success("Saved", {
        description: roleChanged
          ? `${botName} is ${role ? `now your ${ROLES.find((r) => r.id === role)!.label.toLowerCase()}` : "a general assistant again"}.`
          : jobs.length
            ? `${botName} will focus on ${jobs.length === 1 ? "that" : "these"}.`
            : undefined,
      });
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
      description={`Give ${botName} a role, and pick what else matters to you. It leans into these and suggests ideas around them.`}
      footer={
        <>
          <UnsavedDot show={dirty} />
          {dirty ? (
            <Button
              variant="ghost"
              onClick={() => {
                setJobs(saved.jobs);
                setRole(saved.role);
              }}
              disabled={saving}
            >
              Discard
            </Button>
          ) : null}
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
        </>
      }
    >
      <h4 id="settings-role-label" className="text-sm font-semibold">
        Role
      </h4>
      <p className="text-xs text-muted-foreground">A tutor teaches and quizzes you, a job applier finds jobs and tailors each application. Each one starts by asking what it needs.</p>
      <div role="radiogroup" aria-labelledby="settings-role-label" onKeyDown={onRadioGroupKeyDown} className="mt-2 mb-5 flex flex-wrap gap-2">
        {ROLE_OPTIONS.map((r, i) => {
          const on = role === r.id;
          return (
            <button
              key={r.id ?? "general"}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={radioTabIndex(on, i, false)}
              onClick={() => setRole(r.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.97]",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-foreground/30",
              )}
            >
              <span aria-hidden>{r.emoji}</span>
              {r.label}
            </button>
          );
        })}
      </div>
      <h4 id="settings-jobs-label" className="mb-2 text-sm font-semibold">
        Also helps with
      </h4>
      <div role="group" aria-labelledby="settings-jobs-label" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
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
