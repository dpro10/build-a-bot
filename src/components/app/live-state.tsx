"use client";
/**
 * Live state shared by the bot header (avatar mood) and the chat (what's happening).
 */
import * as React from "react";
import type { AvatarMood } from "@/lib/avatars";
import type { ComputerState } from "@/lib/bridge/jobs";

type LiveState = {
  mood: AvatarMood;
  activity: string | null;
  paused: boolean;
  pendingApprovals: number;
  /** A bot on the owner's Claude or ChatGPT plan that waits for their computer: where that computer stands (else null). */
  computer: ComputerState | null;
  setMood: (m: AvatarMood) => void;
  setActivity: (a: string | null) => void;
  setPaused: (p: boolean) => void;
  setPendingApprovals: (n: number | ((n: number) => number)) => void;
  setComputer: (c: ComputerState | null) => void;
};

const Ctx = React.createContext<LiveState | null>(null);

export function BotLiveProvider({
  children,
  initialPaused,
  initialPending,
  initialComputer = null,
}: {
  children: React.ReactNode;
  initialPaused: boolean;
  initialPending: number;
  initialComputer?: ComputerState | null;
}) {
  const [mood, setMood] = React.useState<AvatarMood>(initialPaused ? "sleeping" : initialPending ? "alert" : "idle");
  const [activity, setActivity] = React.useState<string | null>(null);
  const [paused, setPausedState] = React.useState(initialPaused);
  const [pendingApprovals, setPendingApprovals] = React.useState(initialPending);
  const [computer, setComputer] = React.useState<ComputerState | null>(initialComputer);
  const setPaused = React.useCallback((p: boolean) => {
    setPausedState(p);
    setMood(p ? "sleeping" : "happy");
  }, []);
  const value = React.useMemo(
    () => ({ mood: paused ? "sleeping" : mood, activity, paused, pendingApprovals, computer, setMood, setActivity, setPaused, setPendingApprovals, setComputer }),
    [mood, activity, paused, pendingApprovals, computer, setPaused],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBotLive(): LiveState {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    return {
      mood: "idle",
      activity: null,
      paused: false,
      pendingApprovals: 0,
      computer: null,
      setMood: () => {},
      setActivity: () => {},
      setPaused: () => {},
      setPendingApprovals: () => {},
      setComputer: () => {},
    };
  }
  return ctx;
}
