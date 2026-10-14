"use client";
import { Check, CircleAlert, Hand, Loader2, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolView = {
  id: string;
  name: string;
  title: string;
  summary: string;
  state: "running" | "ok" | "error" | "blocked" | "pending_approval";
  detail?: string;
  sources?: { title: string; url: string }[];
};

export function ToolChip({ tool }: { tool: ToolView }) {
  const icon =
    tool.state === "running" ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : tool.state === "ok" ? (
      <Check className="size-3.5" />
    ) : tool.state === "pending_approval" ? (
      <Hand className="size-3.5" />
    ) : tool.state === "blocked" ? (
      <Ban className="size-3.5" />
    ) : (
      <CircleAlert className="size-3.5" />
    );
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "inline-flex max-w-full items-center gap-2 self-start rounded-full border px-3 py-1 text-xs font-medium",
          tool.state === "running" && "border-primary/30 bg-primary-soft text-primary",
          tool.state === "ok" && "border-border bg-card text-muted-foreground",
          tool.state === "pending_approval" && "border-warning/40 bg-warning-soft text-warning",
          tool.state === "blocked" && "border-danger/30 bg-danger-soft text-danger",
          tool.state === "error" && "border-danger/30 bg-danger-soft text-danger",
        )}
        title={tool.detail ?? tool.summary}
      >
        {icon}
        <span className="truncate">{tool.summary || tool.title}</span>
      </div>
      {tool.state === "blocked" && tool.detail ? <div className="pl-2 text-xs text-danger/90">{tool.detail}</div> : null}
      {tool.sources?.length ? (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {tool.sources.slice(0, 4).map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="max-w-[200px] truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {i + 1}. {s.title}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
