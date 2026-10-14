/**
 * Web actions: shared types.
 *
 * No server-only imports in this file, so UI code can import `WebFormPreview` and
 * `readWebFormPreview` to render the preview on an approval card.
 */

/** One value the bot wants typed into a form: the field's visible label and the value. */
export type WebField = { field: string; value: string };

/** What was actually typed, as reported back from the browser. */
export type FilledField = { label: string; value: string };

/** Why the browser stopped instead of finishing. */
export type WebBlocker = "login" | "payment" | "captcha" | "not_found" | "site_blocked" | "other";

/**
 * The preview the owner sees before a filled form is sent. It is stored on the
 * approval as `approval.args.preview` (set by web_form_submit's approval hook).
 */
export type WebFormPreview = {
  kind: "web_form";
  /** The site the form goes to (hostname without "www."). Also the policy "recipient". */
  site: string;
  /** The page the form is on. */
  url: string;
  title?: string;
  /** Exactly what was typed, in order. */
  fields: FilledField[];
  /**
   * Picture of the filled form, ready for `<img src>`: a `data:image/svg+xml` URL in
   * demo mode, or a same-origin path to the real screenshot
   * (`/api/web-actions/<sessionId>/preview`, served with readWebSessionScreenshot).
   */
  image?: string;
  /** Live view of the cloud browser while it's open (provider-hosted), when available. */
  liveUrl?: string;
  /** ISO time the cloud browser closes; the approval expires with it. */
  expiresAt: string;
  /** True when nothing real happened (demo mode). */
  simulated: boolean;
  /** Anything the browser noticed (e.g. "the topic menu had no 'Sales' option"). */
  notes?: string;
};

/** Reads `approval.args.preview` when it's a web-form preview (null otherwise). Safe on any input. */
export function readWebFormPreview(args: unknown): WebFormPreview | null {
  if (!args || typeof args !== "object") return null;
  const p = (args as { preview?: unknown }).preview;
  if (!p || typeof p !== "object") return null;
  const v = p as Partial<WebFormPreview>;
  if (v.kind !== "web_form" || typeof v.site !== "string" || typeof v.url !== "string" || !Array.isArray(v.fields)) return null;
  const fields = v.fields.filter(
    (f): f is FilledField => Boolean(f) && typeof f.label === "string" && typeof f.value === "string",
  );
  return {
    kind: "web_form",
    site: v.site,
    url: v.url,
    title: typeof v.title === "string" ? v.title : undefined,
    fields,
    image: typeof v.image === "string" && (v.image.startsWith("data:image/") || v.image.startsWith("/")) ? v.image : undefined,
    liveUrl: typeof v.liveUrl === "string" && v.liveUrl.startsWith("https://") ? v.liveUrl : undefined,
    expiresAt: typeof v.expiresAt === "string" ? v.expiresAt : new Date(0).toISOString(),
    simulated: v.simulated === true,
    notes: typeof v.notes === "string" ? v.notes : undefined,
  };
}

// ---------------------------------------------------------------------------
// Providers

export type WebReadResult =
  | { ok: true; answer: string; found: boolean; url: string; title?: string; costUsd?: number }
  | { ok: false; error: string; blocker?: WebBlocker };

export type WebFillResult =
  | {
      ok: true;
      /** The provider's browser session, kept open for the submit step. */
      providerSessionId: string;
      url: string;
      title?: string;
      filled: FilledField[];
      notes?: string;
      /** A real screenshot of the filled form (live providers). */
      screenshot?: { contentType: string; base64: string };
      /** A drawn picture of the filled form (demo provider), as a data: URL. */
      previewDataUrl?: string;
      liveUrl?: string;
      costUsd?: number;
    }
  | { ok: false; error: string; blocker?: WebBlocker };

export type WebSubmitResult =
  | { ok: true; confirmation: string; url?: string; costUsd?: number }
  | {
      ok: false;
      error: string;
      blocker?: WebBlocker;
      /** True when the form may have been sent anyway (e.g. timed out after pressing submit). */
      uncertain?: boolean;
    };

/** What the submit step needs from the stored fill. */
export type SubmitInput = {
  providerSessionId: string;
  url: string;
  site: string;
  fields: FilledField[];
  signal?: AbortSignal;
};

export interface WebActionsProvider {
  id: "browser-use" | "demo";
  /** Shown in receipts and tool output ("Browser Use Cloud", "Simulated browser"). */
  label: string;
  simulated: boolean;
  /** How long a filled form can wait for approval before the cloud browser closes. */
  sessionTtlMs: number;
  read(input: { url: string; site: string; task: string; signal?: AbortSignal }): Promise<WebReadResult>;
  fill(input: { url: string; site: string; fields: WebField[]; instructions?: string; signal?: AbortSignal }): Promise<WebFillResult>;
  submit(input: SubmitInput): Promise<WebSubmitResult>;
  /** Close a filled session without sending it (best effort). */
  discard(providerSessionId: string): Promise<void>;
}
