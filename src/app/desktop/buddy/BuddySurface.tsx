"use client";
/**
 * Runs inside the desktop app's transparent bottom-of-screen window. State comes
 * from the desktop app (window.babDesktop); opened in a normal browser, it shows the
 * state from the URL instead (previews, screenshots, tests).
 */
import * as React from "react";
import { Buddy } from "@/components/meetings/Buddy";
import type { BuddyState } from "@/components/meetings/desktop-api";

export function BuddySurface({ initial }: { initial: BuddyState }) {
  const [state, setState] = React.useState<BuddyState>(initial);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.dataset.surface = "overlay";
    const api = window.babDesktop;
    if (!api) return;
    setConnected(true);
    return api.onState(setState);
  }, []);

  // Done: tuck away on its own after a little while.
  React.useEffect(() => {
    if (state.phase !== "done" || !connected) return;
    const t = setTimeout(() => window.babDesktop?.act("hide"), 12_000);
    return () => clearTimeout(t);
  }, [state.phase, connected]);

  return (
    <Buddy
      {...state}
      onAction={(a) => window.babDesktop?.act(a)}
      onInteractive={(on) => window.babDesktop?.setInteractive(on)}
      onCopy={connected ? (text) => window.babDesktop?.copy(text) : undefined}
    />
  );
}
