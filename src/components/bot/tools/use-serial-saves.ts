"use client";
import * as React from "react";

/**
 * Saves that must land in order. Per key, one request runs at a time; while it
 * runs, newer changes replace each other, so only the latest one is sent next.
 * (Clicking Ask → Off → Ask quickly ends as "Ask" on the server, not whichever
 * request happened to finish last.)
 */
export function useSerialSaves() {
  const queues = React.useRef(new Map<string, { running: boolean; next: (() => Promise<void>) | null }>());

  const hasPending = React.useCallback((key: string) => Boolean(queues.current.get(key)?.next), []);

  const enqueue = React.useCallback((key: string, task: () => Promise<void>) => {
    let q = queues.current.get(key);
    if (!q) {
      q = { running: false, next: null };
      queues.current.set(key, q);
    }
    q.next = task;
    if (q.running) return;
    q.running = true;
    const queue = q;
    void (async () => {
      while (queue.next) {
        const run = queue.next;
        queue.next = null;
        try {
          await run();
        } catch {
          /* tasks handle their own errors */
        }
      }
      queue.running = false;
    })();
  }, []);

  return { enqueue, hasPending };
}
