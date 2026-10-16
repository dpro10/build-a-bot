/**
 * Web actions (beta): the bot browses websites and fills in forms in a cloud browser,
 * never the owner's own logged-in one.
 *
 *   web_browse       read   low     find information on a site (outside content: taints the run)
 *   web_form_fill    write  medium  type into a form and stop before sending; the site counts as a
 *                                   recipient, so the prompt-injection and new-recipient rules apply
 *   web_form_submit  send   high    send a filled form. ALWAYS asks the owner, at every trust level
 *                                   (alwaysAsk), with a preview built from what was really typed
 *
 * Code-level limits (src/lib/web-actions/safety.ts): public http(s) pages only, no payments or
 * card/bank details, never passwords, one-time codes or logins, never secrets.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { Recipient } from "@/lib/policy/engine";
import type { ApprovalPreview, ToolApprovalExtras } from "@/lib/agent/run";
import { rateLimit } from "@/lib/safety/ratelimit";
import { checkSpend, recordUsage } from "@/lib/billing/usage";
import { UNIT_PRICES } from "@/lib/billing/prices";
import { truncate } from "@/lib/utils";
import { providerById, webActionsProvider, type WebActionsProvider, type WebFormPreview } from "@/lib/web-actions";
import {
  MAX_FIELDS,
  MAX_VALUE_CHARS,
  PLACEHOLDER_HELP,
  checkUrl,
  normalizeUrl,
  refuseForm,
  refuseRead,
  resolvePlaceholders,
  siteOf,
} from "@/lib/web-actions/safety";
import { claimWebSession, findWebSession, recordSubmitResult, saveWebSession, webSessionPreviewPath } from "@/lib/web-actions/store";
import { UnsafeUrlError } from "../net";
import { defineTool, type AnyToolSpec, type ToolContext } from "../types";

const CONNECTOR = "browser";
/** Real browser tasks per bot per day (they cost money); the simulated browser is unlimited. */
export const DAILY_LIVE_WEB_ACTIONS = 40;
const NOT_SET_UP = "Web actions are coming soon. Say you can't browse websites or fill in forms yet.";
const DAILY_LIMIT = "That's all the web browsing this bot can do today. Try again tomorrow.";
const UNKNOWN_SITE = "unknown-site";

function siteOrUnknown(raw: unknown): string {
  try {
    return typeof raw === "string" ? siteOf(normalizeUrl(raw)) : UNKNOWN_SITE;
  } catch {
    return UNKNOWN_SITE;
  }
}

function urlError(err: unknown): string {
  return err instanceof UnsafeUrlError ? err.message : "That doesn't look like a valid web address.";
}

/** The site as a policy recipient: known once the owner has approved (or run) an action on it. */
async function siteRecipients(site: string, ctx: ToolContext): Promise<Recipient[]> {
  const [row] = await ctx.db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.botId, ctx.bot.id), eq(schema.contacts.kind, "website"), eq(schema.contacts.address, site)))
    .limit(1);
  return [{ address: site, kind: "website", isOwner: false, isKnownContact: Boolean(row) }];
}

async function withinDailyLimit(ctx: ToolContext, provider: WebActionsProvider): Promise<boolean> {
  if (provider.simulated) return true;
  return (await rateLimit(ctx.db, `web-actions:${ctx.bot.id}`, DAILY_LIVE_WEB_ACTIONS, 86_400)).ok;
}

/** Why a real cloud-browser task can't start (it costs money, paid from credit), or null. */
async function spendRefusal(ctx: ToolContext, provider: WebActionsProvider): Promise<string | null> {
  if (provider.simulated) return null;
  const spend = await checkSpend(ctx.db, ctx.owner, "webTask");
  return spend.ok ? null : spend.message;
}

/**
 * A real cloud-browser task is charged what Browser Use charged for it (it reports the cost); one
 * that failed without saying is charged just the start of a task.
 */
async function chargeWebTask(ctx: ToolContext, provider: WebActionsProvider, res: { ok: boolean; costUsd?: number }): Promise<void> {
  if (provider.simulated) return;
  const reported = res.ok && typeof res.costUsd === "number" && Number.isFinite(res.costUsd) && res.costUsd >= 0 ? Math.round(res.costUsd * 1_000_000) : null;
  await recordUsage(ctx.db, ctx.owner.id, { costMicros: reported ?? UNIT_PRICES.webTask });
}

/** Extra fields the agent loop honors (see ToolApprovalExtras in src/lib/agent/run.ts). */
function withApprovalExtras<T extends AnyToolSpec>(spec: T, extras: ToolApprovalExtras): T & ToolApprovalExtras {
  return Object.assign(spec, extras);
}

// ---------------------------------------------------------------------------

export const webBrowse = defineTool({
  name: "web_browse",
  title: "Browse a website",
  description:
    "Open a public website in a cloud browser and find something that takes clicking around: opening hours, prices, availability, locations, schedules, policies. Returns what the site says. For a single page you already have the link to, read_webpage is faster. It never signs in, buys anything or sends forms.",
  input: z.object({
    url: z.string().min(4).max(2000).describe("The site or page to start from, e.g. https://example.com"),
    task: z.string().min(3).max(1000).describe("What to find out, in plain words"),
  }),
  connectorId: CONNECTOR,
  capabilityId: "browse",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Browse ${siteOrUnknown(a.url)}: “${truncate(a.task, 60)}”`,
  async run(args, ctx) {
    const provider = webActionsProvider({ demo: ctx.demo });
    if (!provider) return { ok: false, error: NOT_SET_UP };
    let target: { url: URL; site: string };
    try {
      target = await checkUrl(args.url);
    } catch (err) {
      return { ok: false, error: urlError(err) };
    }
    const refusal = refuseRead(target.url, args.task);
    if (refusal) return { ok: false, error: refusal };
    if (!(await withinDailyLimit(ctx, provider))) return { ok: false, error: DAILY_LIMIT };
    const broke = await spendRefusal(ctx, provider);
    if (broke) return { ok: false, error: broke };

    const res = await provider.read({ url: target.url.toString(), site: target.site, task: args.task, signal: ctx.signal });
    await chargeWebTask(ctx, provider, res);
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      content: [
        `Site: ${target.site}`,
        `Page: ${res.url}`,
        res.title ? `Title: ${res.title}` : "",
        `${res.found ? "Answer" : "Not found on the site"}: ${res.answer}`,
        provider.simulated ? "(Simulated in demo mode: no real website was visited.)" : "",
      ]
        .filter(Boolean)
        .join("\n"),
      summary: provider.simulated ? "Browsed (simulated)" : res.found ? "Found it" : "Not on the site",
      sources: [{ title: res.title ?? target.site, url: res.url }],
    };
  },
});

// ---------------------------------------------------------------------------

const fillInput = z.object({
  url: z.string().min(4).max(2000).describe("The page with the form, e.g. https://example.com/contact"),
  fields: z
    .array(
      z.object({
        field: z.string().min(1).max(120).describe('The field\'s label as shown on the page, e.g. "Email"'),
        value: z.string().max(MAX_VALUE_CHARS).describe(`What to type or choose. ${PLACEHOLDER_HELP} insert the owner's own details.`),
      }),
    )
    .min(1)
    .max(MAX_FIELDS),
  instructions: z.string().max(1000).optional().describe("Extra guidance, e.g. which dropdown option to pick"),
});

/** When the fill itself needs a tap (new site, Ask me first...): show the values with the owner's details filled in. */
async function fillApprovalPreview(args: Record<string, unknown>, ctx: ToolContext): Promise<ApprovalPreview | null> {
  const parsed = fillInput.safeParse(args);
  if (!parsed.success) return null;
  const resolved = resolvePlaceholders(parsed.data.fields, ctx.owner);
  if (!resolved.ok) return null;
  const site = siteOrUnknown(parsed.data.url);
  return {
    detail: [
      `Types into the form on ${site} (${parsed.data.url}). Nothing is sent: sending asks you again, with a preview.`,
      ...resolved.fields.map((f) => `${f.field}: ${truncate(f.value, 400)}`),
      parsed.data.instructions ? `Notes: ${truncate(parsed.data.instructions, 300)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    // Approve exactly these values, even if the owner's profile changes before they tap.
    args: { ...parsed.data, fields: resolved.fields },
  };
}

export const webFormFill = withApprovalExtras(
  defineTool({
    name: "web_form_fill",
    title: "Fill in a web form",
    description: `Fill in a form on a public website in a cloud browser WITHOUT sending it: contact forms, quote or appointment requests, sign-up sheets, RSVPs. Returns what was typed and a session_id. To send it, call web_form_submit next; the owner always sees a preview and approves first. Write values ready to send, and use ${PLACEHOLDER_HELP} for the owner's own details. Refused for payments, card or bank details, passwords and logins.`,
    input: fillInput,
    connectorId: CONNECTOR,
    capabilityId: "fill_forms",
    effect: "write",
    risk: "medium",
    taints: true,
    recipients: (a, ctx) => siteRecipients(siteOrUnknown(a.url), ctx),
    outboundText: (a) => [...a.fields.map((f) => `${f.field}: ${f.value}`), a.instructions ?? ""].join("\n"),
    summarize: (a) => `Fill in the form on ${siteOrUnknown(a.url)} (not sent)`,
    async run(args, ctx) {
      const provider = webActionsProvider({ demo: ctx.demo });
      if (!provider) return { ok: false, error: NOT_SET_UP };
      let target: { url: URL; site: string };
      try {
        target = await checkUrl(args.url);
      } catch (err) {
        return { ok: false, error: urlError(err) };
      }
      const resolved = resolvePlaceholders(args.fields, ctx.owner);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const refusal = refuseForm(target.url, resolved.fields, args.instructions);
      if (refusal) return { ok: false, error: refusal };
      if (!(await withinDailyLimit(ctx, provider))) return { ok: false, error: DAILY_LIMIT };
      const broke = await spendRefusal(ctx, provider);
      if (broke) return { ok: false, error: broke };

      const res = await provider.fill({
        url: target.url.toString(),
        site: target.site,
        fields: resolved.fields,
        instructions: args.instructions,
        signal: ctx.signal,
      });
      await chargeWebTask(ctx, provider, res);
      if (!res.ok) return { ok: false, error: res.error };

      // Check what the browser says it typed, in code, before anyone can send it.
      const landed = siteOrUnknown(res.url);
      const late =
        refuseForm(target.url, res.filled.map((f) => ({ field: f.label, value: f.value }))) ??
        (landed === target.site || landed.endsWith(`.${target.site}`) ? null : "The form led to a different website, so I stopped. Nothing was sent.");
      if (late) {
        await provider.discard(res.providerSessionId);
        return { ok: false, error: late };
      }

      const session = await saveWebSession(ctx.db, {
        botId: ctx.bot.id,
        ownerId: ctx.owner.id,
        expiresAt: new Date(Date.now() + provider.sessionTtlMs),
        data: {
          provider: provider.id,
          providerSessionId: res.providerSessionId,
          url: res.url,
          site: target.site,
          title: res.title,
          fields: res.filled,
          requested: resolved.fields,
          notes: res.notes,
          screenshot: res.screenshot,
          previewDataUrl: res.previewDataUrl,
          liveUrl: res.liveUrl,
          simulated: provider.simulated,
        },
      });
      const minutes = Math.round(provider.sessionTtlMs / 60_000);
      return {
        ok: true,
        content: [
          `Filled in the form on ${target.site}. It is NOT sent yet.`,
          `Page: ${res.url}`,
          res.title ? `Title: ${res.title}` : "",
          "Typed:",
          ...res.filled.map((f) => `- ${f.label}: ${truncate(f.value, 300)}`),
          res.notes ? `Browser notes: ${res.notes}` : "",
          `session_id: ${session.id} (the browser stays open about ${minutes} minutes)`,
          `To send it, call web_form_submit with session_id "${session.id}": ${ctx.owner.name?.trim() || "the owner"} sees this preview and approves first. If anything looks wrong, fill it again instead.`,
          provider.simulated ? "(Simulated in demo mode: no real website was touched.)" : "",
        ]
          .filter(Boolean)
          .join("\n"),
        summary: `Filled ${res.filled.length} field${res.filled.length === 1 ? "" : "s"}, not sent${provider.simulated ? " (simulated)" : ""}`,
        sources: [{ title: res.title ?? target.site, url: res.url }],
      };
    },
  }),
  { approvalPreview: fillApprovalPreview },
);

// ---------------------------------------------------------------------------

const submitInput = z.object({
  session_id: z.string().max(64).optional().describe("The session_id from web_form_fill; omit to send the most recent filled form"),
});

/** The approval card: built from the stored fill (what was really typed), never from the model's words. */
async function submitApprovalPreview(args: Record<string, unknown>, ctx: ToolContext): Promise<ApprovalPreview | null> {
  const s = await findWebSession(ctx.db, ctx.bot.id, typeof args.session_id === "string" ? args.session_id : null);
  if (!s || s.usedAt || s.expiresAt.getTime() <= Date.now()) {
    return {
      title: "Send a web form (nothing waiting)",
      detail: "No filled-in form is waiting: it was already sent, or its browser closed. Approving won't send anything; ask your bot to fill it in again.",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
  }
  const preview: WebFormPreview = {
    kind: "web_form",
    site: s.site,
    url: s.url,
    title: s.title,
    fields: s.fields,
    image: s.previewDataUrl ?? (s.screenshot ? webSessionPreviewPath(s.id) : undefined),
    liveUrl: s.liveUrl,
    expiresAt: s.expiresAt.toISOString(),
    simulated: s.simulated,
    notes: s.notes,
  };
  const minutes = Math.max(1, Math.round((s.expiresAt.getTime() - Date.now()) / 60_000));
  return {
    title: `Send the form on ${s.site}`,
    detail: [
      `Sends to: ${s.site}`,
      `Page: ${s.url}`,
      ...s.fields.map((f) => `${f.label}: ${truncate(f.value, 600)}`),
      s.notes ? `Browser notes: ${s.notes}` : "",
      `Not sent yet. Approve within ${minutes} min, while the browser is still open.${s.simulated ? " (Simulated in demo mode.)" : ""}`,
    ]
      .filter(Boolean)
      .join("\n"),
    // Pin the approval to this exact fill (also when the model left session_id out).
    args: { session_id: s.id, preview },
    expiresAt: s.expiresAt,
  };
}

export const webFormSubmit = withApprovalExtras(
  defineTool({
    name: "web_form_submit",
    title: "Submit a web form",
    description:
      "Send a form you filled in with web_form_fill. It always waits for the owner's approval after showing them a preview of exactly what goes where, at every trust level, so call it once and tell the owner it's waiting for their OK. Pass the session_id from web_form_fill (omit it to use the most recent filled form).",
    input: submitInput,
    connectorId: CONNECTOR,
    capabilityId: "submit_forms",
    effect: "send",
    risk: "high",
    taints: true,
    recipients: async (a, ctx) => {
      const s = await findWebSession(ctx.db, ctx.bot.id, a.session_id ?? null);
      return siteRecipients(s?.site ?? UNKNOWN_SITE, ctx);
    },
    summarize: () => "Send a filled-in web form",
    async run(args, ctx) {
      const found = await findWebSession(ctx.db, ctx.bot.id, args.session_id ?? null);
      if (!found) {
        return { ok: false, error: args.session_id ? "I can't find that filled-in form. Fill it in again first." : "There's no filled-in form waiting to be sent. Fill one in first." };
      }
      if (found.usedAt) return { ok: false, error: "That form was already sent (or a send was attempted). Fill it in again to send another." };
      if (found.expiresAt.getTime() <= Date.now()) {
        return { ok: false, error: "The browser holding that form has closed, so nothing was sent. Ask me to fill it in again." };
      }
      const provider = providerById(found.provider);
      if (!provider) return { ok: false, error: NOT_SET_UP };
      // Same limits as the fill, checked again on what's about to leave.
      const refusal = refuseForm(new URL(found.url), found.fields.map((f) => ({ field: f.label, value: f.value })));
      if (refusal) return { ok: false, error: refusal };

      // One-shot: claimed before anything is sent, so a second approval can't send it twice.
      const session = await claimWebSession(ctx.db, ctx.bot.id, found.id);
      if (!session) return { ok: false, error: "That form was already sent or its browser has closed. Fill it in again." };
      const res = await provider.submit({
        providerSessionId: session.providerSessionId,
        url: session.url,
        site: session.site,
        fields: session.fields,
        signal: ctx.signal,
      });
      await chargeWebTask(ctx, provider, res);
      await recordSubmitResult(ctx.db, session.id, {
        at: new Date().toISOString(),
        ok: res.ok,
        ...(res.ok ? { confirmation: res.confirmation } : { error: res.error }),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return {
        ok: true,
        content: `${provider.simulated ? "(Demo: simulated, nothing was actually sent.) " : ""}Sent the form on ${session.site}. The site said: “${res.confirmation}”`,
        summary: provider.simulated ? "Simulated send" : "Sent",
        sources: [{ title: session.title ?? session.site, url: res.url ?? session.url }],
      };
    },
  }),
  { alwaysAsk: true, approvalPreview: submitApprovalPreview },
);

export const browserTools: AnyToolSpec[] = [webBrowse, webFormFill, webFormSubmit];
