"use client";
import * as React from "react";

/**
 * Deep links like `/tools#gmail` or `/tools?tab=channels#discord` (from the setup checklist):
 * scroll the matching element into view and briefly highlight it. Returns the id
 * that's highlighted right now, or null. `focus(id)` does the same on demand.
 */
export function useHashTarget(ready = true) {
  const [target, setTarget] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = React.useCallback((id: string, opts: { block?: ScrollLogicalPosition } = {}) => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: opts.block ?? "center" });
    setTarget(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTarget(null), 2800);
    return true;
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (id) focus(id);
    };
    // Let the page lay out first so the scroll lands in the right place.
    const t = setTimeout(fromHash, 120);
    window.addEventListener("hashchange", fromHash);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", fromHash);
    };
  }, [focus, ready]);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { target, focus };
}
