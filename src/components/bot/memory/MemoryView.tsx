"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Lock, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { useNow } from "@/components/bot/activity/time";
import { MemoriesPanel } from "./MemoriesPanel";
import { NotesPanel } from "./NotesPanel";
import { PeoplePanel } from "./PeoplePanel";
import { matches, type ContactItem, type MemoryItem, type NoteItem } from "./types";

type Tab = "memories" | "notes" | "people";

export function MemoryView({
  botId,
  botName,
  avatar,
  color,
  trust,
  serverNow,
  initialTab,
  initialImport = false,
  initial,
}: {
  botId: string;
  botName: string;
  avatar: AvatarId;
  color: ColorwayId;
  trust: string;
  serverNow: string;
  initialTab: Tab;
  /** Opened from a "Bring my memories" link (?import=1). */
  initialImport?: boolean;
  initial: { memories: MemoryItem[]; notes: NoteItem[]; contacts: ContactItem[] };
}) {
  const now = useNow(serverNow);
  const [tab, setTab] = React.useState<Tab>(initialImport ? "memories" : initialTab);
  const [importOpen, setImportOpen] = React.useState(initialImport);
  const [query, setQuery] = React.useState("");
  const [memories, setMemories] = React.useState(initial.memories);
  const [notes, setNotes] = React.useState(initial.notes);
  const [contacts, setContacts] = React.useState(initial.contacts);

  const choose = (value: string) => {
    const t = value as Tab;
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "memories") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  };

  const q = query.trim();
  const count = (n: number, filtered: number) => (q ? `${filtered}/${n}` : String(n));
  const counts = {
    memories: count(memories.length, memories.filter((m) => matches(q, m.text)).length),
    notes: count(notes.length, notes.filter((n) => matches(q, n.title, n.body)).length),
    people: count(contacts.length, contacts.filter((c) => matches(q, c.name, c.address)).length),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">Memory</h2>
        <p className="text-muted-foreground">What {botName} knows about you, its notebook, and the people it can talk to.</p>
      </div>

      <div className="flex items-start gap-3 rounded-3xl border border-border bg-card p-4 shadow-soft sm:items-center sm:gap-4 sm:p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary sm:size-10">
          <Lock className="size-[18px] sm:size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">This stays with {botName}.</span> Only {botName} uses what&apos;s here, never your other bots.
            Change or delete anything, anytime.
          </p>
          <Link href="/app/account" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Export from Account <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <Tabs value={tab} onValueChange={choose} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="self-start">
            <TabsTrigger value="memories">
              Memories <span className="ml-1 text-muted-foreground tabular-nums">{counts.memories}</span>
            </TabsTrigger>
            <TabsTrigger value="notes">
              Notes <span className="ml-1 text-muted-foreground tabular-nums">{counts.notes}</span>
            </TabsTrigger>
            <TabsTrigger value="people">
              People <span className="ml-1 text-muted-foreground tabular-nums">{counts.people}</span>
            </TabsTrigger>
          </TabsList>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="memory-search" className="sr-only">
              Search memory
            </label>
            <Input
              id="memory-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "people" ? "Search people" : tab === "notes" ? "Search notes" : "Search memories"}
              className="h-10 pr-9 pl-10 text-sm [&::-webkit-search-cancel-button]:hidden"
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <TabsContent value="memories" forceMount className="data-[state=inactive]:hidden">
          <MemoriesPanel
            botId={botId}
            botName={botName}
            avatar={avatar}
            color={color}
            items={memories}
            setItems={setMemories}
            query={q}
            now={now}
            importOpen={importOpen}
            setImportOpen={(open) => {
              setImportOpen(open);
              // Closing it drops ?import=1, so a reload doesn't reopen it.
              if (!open && new URL(window.location.href).searchParams.has("import")) {
                const url = new URL(window.location.href);
                url.searchParams.delete("import");
                window.history.replaceState(window.history.state, "", url);
              }
            }}
          />
        </TabsContent>
        <TabsContent value="notes" forceMount className="data-[state=inactive]:hidden">
          <NotesPanel botId={botId} botName={botName} items={notes} setItems={setNotes} query={q} now={now} />
        </TabsContent>
        <TabsContent value="people" forceMount className="data-[state=inactive]:hidden">
          <PeoplePanel botId={botId} botName={botName} trust={trust} items={contacts} setItems={setContacts} query={q} now={now} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
