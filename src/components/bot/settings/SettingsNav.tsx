"use client";
import * as React from "react";
import { Brain, Palette, PlugZap, Share2, Target, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { id: "look", label: "Look & personality", icon: Palette },
  { id: "jobs", label: "What it helps with", icon: Target },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "share", label: "Share as a recipe", icon: Share2 },
  { id: "mcp", label: "Other AI apps", icon: PlugZap },
  { id: "danger", label: "Danger zone", icon: TriangleAlert },
];

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** Sticky jump list for the settings page (desktop). */
export function SettingsNav() {
  const [active, setActive] = React.useState("look");
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const scroller = scrollParent(ref.current);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const atBottom = scroller
        ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
        : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) return setActive(ITEMS[ITEMS.length - 1].id);
      let current = ITEMS[0].id;
      for (const item of ITEMS) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top - top <= 140) current = item.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <nav ref={ref} aria-label="Settings sections" className="sticky top-6 hidden self-start lg:block">
      <ul className="flex flex-col gap-0.5">
        {ITEMS.map((i) => {
          const on = active === i.id;
          return (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(i.id);
                }}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                  on ? "bg-card text-foreground shadow-soft ring-1 ring-border" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  i.id === "danger" && !on && "text-danger/80 hover:text-danger",
                )}
              >
                <i.icon className="size-4" aria-hidden />
                {i.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
