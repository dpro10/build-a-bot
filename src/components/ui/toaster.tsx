"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border !border-border !bg-card !text-card-foreground !shadow-lift !font-sans !text-sm",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}
export { toast } from "sonner";
