"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  side = "center",
  ...props
}: React.ComponentProps<typeof D.Content> & { side?: "center" | "bottom" | "right" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-up_0.2s_ease-out]" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-lift outline-none",
          side === "center" &&
            "top-1/2 left-1/2 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-3xl data-[state=open]:animate-pop",
          side === "bottom" &&
            "inset-x-0 bottom-0 rounded-t-3xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[fade-up_0.25s_ease-out] sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[min(560px,calc(100vw-24px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
          side === "right" && "inset-y-0 right-0 w-[min(460px,100vw)] rounded-l-3xl",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-5" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 px-6 pt-6 pb-2 pr-12", className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scrollbar-thin flex-1 overflow-y-auto px-6 py-3", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 px-6 pt-3 pb-6", className)} {...props} />;
}

export const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof D.Title>) => (
  <D.Title className={cn("font-display text-xl font-semibold", className)} {...props} />
);

export const DialogDescription = ({ className, ...props }: React.ComponentProps<typeof D.Description>) => (
  <D.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
);
