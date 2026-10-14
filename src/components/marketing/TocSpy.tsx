"use client";
import * as React from "react";

/** Marks the table-of-contents link for the section currently in view (data-active="true"). */
export function TocSpy({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const key = ids.join("|");

  React.useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const sections = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const visible = new Map<string, boolean>();
    const mark = () => {
      const active = sections.find((s) => visible.get(s.id)) ?? null;
      root.querySelectorAll<HTMLAnchorElement>("[data-toc]").forEach((a) => {
        a.dataset.active = String(active !== null && a.dataset.toc === active.id);
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        mark();
      },
      { rootMargin: "-90px 0px -55% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [key]);

  return <div ref={ref}>{children}</div>;
}
