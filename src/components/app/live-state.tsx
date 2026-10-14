"use client";
/**
 * Live state shared by the bot header (avatar mood) and the chat (what's happening).
 */
import * as React from "react";
import type { AvatarMood } from "@/lib/avatars";

type LiveState = {
  mood: AvatarMood;
  activity: string | null;
  paused: boolean;
  pendingApprovals: number;
  setMood: (m: AvatarMood) => void;
  setActivity: (a: string | null) => void;
  setPaused: (p: boolean) => void;
  setPendingApprovals: (n: number | ((n: number) => number)) => void;
};

const Ctx = React.createContext<LiveState | null>(null);

export function BotLiveProvider({ children, initialPaused, initialPending }: { children: React.ReactNode; initialPaused: boolean; initialPending: number }) {
  const [mood, setMood] = React.useState<AvatarMood>(initialPaused ? "sleeping" : initialPending ? "alert" : "idle");
  const [activity, setActivity] = React.useState<string | null>(null);
  const [paused, setPausedState] = React.useState(initialPaused);
  const [pendingApprovals, setPendingApprovals] = React.useState(initialPending);
  const setPaused = React.useCallback((p: boolean) => {
    setPausedState(p);
    setMood(p ? "sleeping" : "happy");
  }, []);
  const value = React.useMemo(
    () => ({ mood: paused ? "sleeping" : mood, activity, paused, pendingApprovals, setMood, setActivity, setPaused, setPendingApprovals }),
    [mood, activity, paused, pendingApprovals, setPaused],
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
      setMood: () => {},
      setActivity: () => {},
      setPaused: () => {},
      setPendingApprovals: () => {},
    };
  }
  return ctx;
}
