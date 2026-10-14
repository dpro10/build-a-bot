"use client";
/**
 * Delete with a real undo: the item leaves the list at once, the DELETE goes out
 * a few seconds later unless the owner taps Undo. Leaving the page (or this tab)
 * sends any pending deletes right away, so nothing is silently kept.
 */
import * as React from "react";
import { toast } from "@/components/ui/toaster";

const UNDO_MS = 5000;

type Pending = { url: string; timer: number; toastId: string | number; onFail: () => void };

export function usePendingDelete() {
  const pending = React.useRef(new Map<string, Pending>());

  const commit = React.useCallback((key: string) => {
    const p = pending.current.get(key);
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current.delete(key);
    toast.dismiss(p.toastId);
    void fetch(p.url, { method: "DELETE", keepalive: true })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => {
        p.onFail();
        toast.error("Couldn't delete that. It's back in the list.");
      });
  }, []);

  React.useEffect(() => {
    const map = pending.current;
    const flushAll = () => {
      for (const key of [...map.keys()]) commit(key);
    };
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
  }, [commit]);

  /** Remove now, delete for real in a few seconds unless undone. */
  return React.useCallback(
    (key: string, url: string, opts: { message: string; description?: string; onUndo: () => void }) => {
      const toastId = toast(opts.message, {
        description: opts.description,
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const p = pending.current.get(key);
            if (!p) return;
            window.clearTimeout(p.timer);
            pending.current.delete(key);
            opts.onUndo();
          },
        },
      });
      const timer = window.setTimeout(() => commit(key), UNDO_MS + 400);
      pending.current.set(key, { url, timer, toastId, onFail: opts.onUndo });
    },
    [commit],
  );
}
