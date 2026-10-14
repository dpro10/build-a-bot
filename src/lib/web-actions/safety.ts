/**
 * Web-action safety rules, enforced in code before anything reaches a browser.
 * The browser agent is told the same rules (./prompts.ts), but it is never relied on.
 *
 *  - Only public http(s) pages (the same SSRF guard the web reader uses).
 *  - No payments in v1: no checkout or payment pages, no card or bank details.
 *  - Never the owner's passwords, PINs or one-time codes, and no signing in.
 *  - Never secrets (API keys, private keys) or Social Security numbers.
 */
import type { User } from "@/lib/db/schema";
import { containsSecret } from "@/lib/policy/engine";
import { assertPublicUrl } from "@/lib/tools/net";
import type { WebField } from "./types";

export const REFUSAL = {
  payment:
    "Web actions never pay or enter card or bank details: money is off in this version. You can finish a payment yourself; I can find the page or fill in the parts that aren't payment.",
  login:
    "I never type passwords or one-time codes, and I don't sign in to websites for you. If the page needs your account, sign in yourself; I can handle forms that don't need a login.",
  secret: "That looks like a password, API key or ID number. Secrets never leave, so I won't type it into a website.",
} as const;

export const MAX_FIELDS = 30;
export const MAX_VALUE_CHARS = 2000;

/** "example.com/contact" → "https://example.com/contact"; anything with a scheme is kept as is. */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
}

/** The site a URL belongs to, as the owner thinks of it: hostname without "www.". */
export function siteOf(url: URL | string): string {
  const host = (typeof url === "string" ? new URL(url) : url).hostname.toLowerCase().replace(/\.$/, "");
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Public http(s) pages only. Throws UnsafeUrlError (from tools/net) with a readable message. */
export async function checkUrl(raw: string): Promise<{ url: URL; site: string }> {
  const url = await assertPublicUrl(normalizeUrl(raw));
  return { url, site: siteOf(url) };
}

const PAYMENT_PATH = /\/(checkout|cart|basket|payment|payments|pay|billing|donate|donation)(\/|$|\?|#|\.)/i;
const PAYMENT_LABEL =
  /\b(credit|debit)\s*card\b|\bcard\s*(number|no\.?|holder|details|info)\b|\bname on card\b|\bcvv2?\b|\bcvc2?\b|\bcvn\b|\bcsc\b|\bexpir(y|ation)\b|\bexp\.?\s*date\b|\biban\b|\bswift\b|\bbic\b|\brouting\s*(number|no\.?)?\b|\bsort code\b|\b(bank|checking|savings)\s*account\b|\baccount\s*(number|no\.?)\b|\bpaypal\b|\bvenmo\b|\bzelle\b|\bcash\s?app\b|\bwallet address\b|\bbitcoin\b/i;
const PAYMENT_INTENT =
  /\b(pay(ing)? (for|the|my|with|by|online|now|it|this|that)|make (a|the) payment|payment (form|page|details|info)|checkout|purchase|buy (it|this|that|now|me|tickets?|the|a)|place (an |the |my )?order|add (it |this |that )?to (the |my )?(cart|basket|bag)|donat(e|ion)|top up|send money|wire transfer|transfer money)\b/i;
const PASSWORD_LABEL =
  /\b(pass\s?word|passcode|passphrase|pwd|pin\b(?!\s*code)|one[-\s]?time (code|password|passcode|pin)|otp|2fa|mfa|two[-\s]?factor|verification code|security (question|answer)|login code|auth(entication)? code|memorable word)\b/i;
const LOGIN_INTENT = /\b(log ?in|sign ?in|sign into|my account|create (an |my )?account|register (an |my )?account|reset (my |the )?password)\b/i;
const ID_LABEL = /\b(ssn|social security|itin|tax id)\b/i;
const SSN_VALUE = /\b\d{3}-\d{2}-\d{4}\b/;
const IBAN_VALUE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 13–19 digits (spaces or dashes allowed) that pass the Luhn check: a payment card number. */
export function looksLikeCardNumber(value: string): boolean {
  for (const m of value.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhnOk(digits)) return true;
  }
  return false;
}

/** Why a page can't be read this way, or null when it's fine. */
export function refuseRead(url: URL, task: string): string | null {
  if (PAYMENT_INTENT.test(task)) return REFUSAL.payment;
  if (LOGIN_INTENT.test(task)) return REFUSAL.login;
  if (containsSecret(task)) return REFUSAL.secret;
  void url;
  return null;
}

/** Why a form can't be filled, or null when it's fine. Runs on resolved values. */
export function refuseForm(url: URL, fields: WebField[], instructions?: string): string | null {
  const extra = instructions ?? "";
  if (PAYMENT_PATH.test(url.pathname + url.search) || PAYMENT_INTENT.test(extra)) return REFUSAL.payment;
  if (LOGIN_INTENT.test(extra) || /\/(login|log-in|signin|sign-in|auth)(\/|$|\?|#|\.)/i.test(url.pathname)) return REFUSAL.login;
  for (const { field, value } of fields) {
    if (PAYMENT_LABEL.test(field) || looksLikeCardNumber(value) || IBAN_VALUE.test(value.toUpperCase())) return REFUSAL.payment;
    if (PASSWORD_LABEL.test(field)) return REFUSAL.login;
    if (ID_LABEL.test(field) || SSN_VALUE.test(value) || containsSecret(value)) return REFUSAL.secret;
  }
  if (containsSecret(extra) || looksLikeCardNumber(extra)) return REFUSAL.secret;
  return null;
}

// ---------------------------------------------------------------------------
// The owner's own details, filled in by the server so the model needn't know them.

export const PLACEHOLDER_HELP = "{{my_name}}, {{my_first_name}}, {{my_last_name}}, {{my_email}}";

function ownerValues(owner: Pick<User, "name" | "email">): Record<string, string | undefined> {
  const name = owner.name?.trim() || undefined;
  const parts = name?.split(/\s+/) ?? [];
  return {
    my_name: name,
    my_first_name: parts[0],
    my_last_name: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
    my_email: owner.email?.trim() || undefined,
  };
}

/** Replaces {{my_name}}-style placeholders with the owner's details from their account. */
export function resolvePlaceholders(
  fields: WebField[],
  owner: Pick<User, "name" | "email">,
): { ok: true; fields: WebField[] } | { ok: false; error: string } {
  const values = ownerValues(owner);
  const out: WebField[] = [];
  for (const f of fields) {
    const problems: string[] = [];
    const value = f.value.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
      const k = key.toLowerCase();
      if (!(k in values)) {
        problems.push(`Unknown placeholder ${whole}. Use ${PLACEHOLDER_HELP}.`);
        return whole;
      }
      const v = values[k];
      if (!v) problems.push(`I don't know your ${k.replace(/^my_/, "").replace(/_/g, " ")} yet. Tell me and I'll use it.`);
      return v ?? "";
    });
    if (problems.length) return { ok: false, error: problems[0] };
    out.push({ field: f.field.trim(), value: value.trim() });
  }
  return { ok: true, fields: out };
}
