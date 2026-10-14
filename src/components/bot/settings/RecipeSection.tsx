"use client";
import * as React from "react";
import { Check, Download, EyeOff, ExternalLink, RefreshCw, Share2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { FieldGroup, SettingsSection, useApiErrorToast } from "./ui";

const INCLUDED = ["Look and name", "Personality and custom instructions", "What it helps with", "Which apps (never your sign-ins)", "Channels", "Trust level", "Daily and weekly routines"];
const NEVER = ["Messages and chats", "Memories, notes and people", "API keys, tokens and sign-ins", "Receipts and activity"];

export type SharedRecipe = { slug: string; url: string; public: boolean; description: string };

export function RecipeSection({
  botId,
  botName,
  hasInstructions,
  initial,
}: {
  botId: string;
  botName: string;
  hasInstructions: boolean;
  initial: SharedRecipe | null;
}) {
  const onError = useApiErrorToast();
  const [recipe, setRecipe] = React.useState(initial);
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [busy, setBusy] = React.useState<"publish" | "unpublish" | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const live = Boolean(recipe?.public);

  const publish = async () => {
    setBusy("publish");
    try {
      const res = await api<{ slug: string; url: string; public: boolean; description: string }>(`/api/bots/${botId}/recipe`, {
        method: "POST",
        body: { description: description.trim() },
      });
      const wasLive = live;
      const hadLink = Boolean(recipe);
      setRecipe({ slug: res.slug, url: res.url, public: true, description: res.description });
      toast.success(wasLive ? "Shared copy updated" : hadLink ? "Sharing is back on" : "Your recipe is live", {
        description: wasLive ? `The link now shows ${botName} as it is today.` : "Anyone with the link can make their own copy.",
      });
    } catch (err) {
      onError(err, "Couldn't publish. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    setBusy("unpublish");
    try {
      await api(`/api/bots/${botId}/recipe`, { method: "DELETE" });
      setRecipe((r) => (r ? { ...r, public: false } : r));
      setConfirm(false);
      toast.success("Sharing is off", { description: "The link stopped working. Copies people already made are theirs to keep." });
    } catch (err) {
      onError(err, "Couldn't unpublish. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection
      id="share"
      icon={Share2}
      title="Share as a recipe"
      description={`A recipe is a blueprint of ${botName}. Friends can open the link and build their own copy in a minute, with their own apps and sign-ins.`}
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-background-2/60 p-4">
            <div className="mb-2 text-xs font-bold tracking-wide text-success uppercase">Included</div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {INCLUDED.map((x) => (
                <li key={x} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-background-2/60 p-4">
            <div className="mb-2 text-xs font-bold tracking-wide text-danger uppercase">Never included</div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {NEVER.map((x) => (
                <li key={x} className="flex items-start gap-2">
                  <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {hasInstructions ? (
          <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-foreground">
            Your custom instructions go along as written. Give them a quick look for anything personal before you share.
          </p>
        ) : null}

        {recipe ? (
          <div className={cn("flex flex-col gap-3 rounded-2xl border p-4", live ? "border-primary/25 bg-primary-soft/50" : "border-border bg-muted/50")}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              Your share link
              {live ? (
                <Badge tone="success">
                  <span className="size-1.5 rounded-full bg-success" aria-hidden /> Live
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <EyeOff /> Off
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                className={cn(
                  "min-w-0 flex-1 truncate rounded-xl bg-card px-3 py-2.5 font-mono text-sm ring-1 ring-border",
                  !live && "text-muted-foreground line-through",
                )}
              >
                {recipe.url}
              </code>
              {live ? (
                <div className="flex gap-2">
                  <CopyButton value={recipe.url} label="Copy link" className="h-10" />
                  <Button asChild variant="outline" size="sm" className="h-10">
                    <a href={`/r/${recipe.slug}`} target="_blank" rel="noopener noreferrer">
                      Open <ExternalLink />
                    </a>
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {live
                ? `Changed ${botName} since? Update the shared copy and the same link shows ${botName} as it is now.`
                : `Sharing is off, so the link shows a not-found page. Publish again and the same link comes back with ${botName} as it is now.`}
            </p>
          </div>
        ) : null}

        <FieldGroup label="A line about it (optional)" htmlFor="recipe-desc" hint="Shown on the share page.">
          <Input
            id="recipe-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={280}
            placeholder={`What ${botName} is great at, in a sentence`}
            autoComplete="off"
          />
        </FieldGroup>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button asChild variant="outline" className="mr-auto sm:mr-0">
            <a href={`/api/bots/${botId}/recipe`} download>
              <Download /> Download JSON
            </a>
          </Button>
          {live ? (
            <>
              <Button variant="danger-soft" onClick={() => setConfirm(true)} disabled={busy !== null}>
                <EyeOff /> Unpublish
              </Button>
              <Button onClick={publish} loading={busy === "publish"}>
                {busy === "publish" ? null : <RefreshCw />} Update shared copy
              </Button>
            </>
          ) : (
            <Button onClick={publish} loading={busy === "publish"}>
              {busy === "publish" ? null : <Share2 />} {recipe ? "Publish again" : "Publish a share link"}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={(o) => busy === null && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop sharing {botName}?</DialogTitle>
            <DialogDescription>
              The link stops working right away. People who already made their own copy keep it. You can publish again anytime, and the same link comes back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy !== null}>
              Keep sharing
            </Button>
            <Button variant="danger" onClick={unpublish} loading={busy === "unpublish"}>
              <EyeOff /> Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
