/**
 * What a web form will send, shown on approvals for web_form_submit: the site,
 * every field and value the bot typed, and a picture of the filled form.
 */
import { ExternalLink, Globe } from "lucide-react";
import type { WebFormPreview as Preview } from "@/lib/web-actions/types";
import { Badge } from "@/components/ui/badge";

/** Once the owner has decided, the footer says what happened instead of "nothing has been sent yet". */
const DECIDED: Record<string, string> = {
  executed: "Sent after your OK.",
  approved: "Approved. Sending it now.",
  denied: "Not sent. You declined.",
  expired: "Not sent. The filled form expired.",
  failed: "Not sent. Something went wrong on the site.",
};

export function WebFormPreview({ preview, compact, status }: { preview: Preview; compact?: boolean; status?: string }) {
  const decided = status && status !== "pending" ? (DECIDED[status] ?? null) : null;
  const expires = new Date(preview.expiresAt);
  const expiresLabel = Number.isFinite(expires.getTime()) && expires.getTime() > 0 ? expires.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-background-2/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-semibold">{preview.site}</span>
        {preview.title ? <span className="min-w-0 truncate text-muted-foreground">· {preview.title}</span> : null}
        {preview.simulated ? <Badge tone="warning">Simulated</Badge> : null}
      </div>
      <div className={compact ? "grid gap-3 p-3" : "grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}>
        <dl className="flex flex-col gap-1.5 text-sm">
          {preview.fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="grid grid-cols-[minmax(4rem,auto)_minmax(0,1fr)] gap-3">
              <dt className="truncate text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 font-medium [overflow-wrap:anywhere] whitespace-pre-wrap">{f.value || "—"}</dd>
            </div>
          ))}
        </dl>
        {preview.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URLs and our own private screenshot route
          <img src={preview.image} alt={`The filled form on ${preview.site}`} className="max-h-72 w-full rounded-xl border border-border bg-white object-contain object-top" loading="lazy" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {decided ? (
          <span>{decided}</span>
        ) : (
          <>
            <span>Nothing has been sent yet.</span>
            {/* The viewer's own clock: the server renders this in its time zone, the browser in yours. */}
            {expiresLabel ? <span suppressHydrationWarning>{`The filled form is held until ${expiresLabel}.`}</span> : null}
          </>
        )}
        {preview.liveUrl && !decided ? (
          <a href={preview.liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            Watch the browser <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
      {preview.notes ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{preview.notes}</p> : null}
    </div>
  );
}
