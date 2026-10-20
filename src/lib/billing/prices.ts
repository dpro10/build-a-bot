/**
 * What things cost: no plans, people pay for what they use, at cost. Diego (2026-10-16): "People
 * should just pay for their usage, and I'll be happy breaking even at first." Every price here is
 * what the service charges Build-a-bot, with nothing added (docs/DECISIONS.md). Safe for the browser.
 *
 *  - Thinking on an included model: the model's Token Factory price per token (models/catalog.ts).
 *  - Your own AI key: free here (your provider bills you). Speech heard on your computer
 *    (NVIDIA Parakeet): free.
 *  - Web lookups, texts, calls and the cloud browser: the per-use prices below.
 *  - Adding credit: Stripe's card fee is added on top, so the credit is all yours.
 */
import type { ModelDef } from "@/lib/models/catalog";

/** Per-use prices, in micro-dollars (millionths of a dollar). */
export const UNIT_PRICES = {
  /** Tavily: a web search, the news, or reading one page is one credit, $0.008. */
  lookup: 8_000,
  /** Twilio (US): $0.0083 for each segment of a text someone sends the bot. */
  textIn: 8_300,
  /** Twilio (US): $0.0083 for each segment of a text the bot sends, plus about $0.004 of carrier fees. */
  textOut: 12_500,
  /** Twilio (US): about $0.01 a minute on a call, plus $0.02 each time it listens for speech (about twice a minute). */
  callMinute: 50_000,
  /**
   * A call the bot makes to read you a message (a reminder, "Call me"): Twilio's $0.014 a minute to
   * call out, plus about $0.006 for reading the message aloud ($0.0032 per 100 characters, neural voice).
   */
  callMinuteOut: 20_000,
  /**
   * A call answered by our voice server (NVIDIA speech on our own machine, so no per-use speech fees):
   * Twilio's $0.0085 a minute for an incoming call to a local number, plus $0.0044 for the audio stream.
   */
  callMinuteStreamIn: 12_900,
  /** …and $0.014 a minute when the bot calls out, plus the stream. */
  callMinuteStreamOut: 18_400,
  /** Browser Use Cloud: $0.01 to start a task in the cloud browser… */
  webTask: 10_000,
  /** …and about $0.006 for each step it takes. A task is charged what Browser Use reports it cost. */
  webStep: 6_000,
} as const;

/**
 * What one message usually takes: about 5,000 tokens in (the bot's instructions, what it
 * remembers, the conversation) and 500 out. Real messages vary; each one is charged for what it used.
 */
export const TYPICAL_MESSAGE = { inputTokens: 5_000, outputTokens: 500 } as const;

/** About what an hour of meeting notes takes: the hour's transcript in (about 9,000 words), the notes out. */
export const TYPICAL_MEETING_HOUR = { inputTokens: 13_500, outputTokens: 1_500 } as const;

/** About what voice typing's AI cleanup takes, for one thing you say. */
export const TYPICAL_CLEANUP = { inputTokens: 600, outputTokens: 100 } as const;

type Tokens = { inputTokens: number; outputTokens: number };

/** What `tokens` cost on a model, in micro-dollars (its price is per million tokens). */
export function tokensMicros(m: Pick<ModelDef, "priceIn" | "priceOut">, tokens: Tokens): number {
  return Math.round(tokens.inputTokens * (m.priceIn ?? 0) + tokens.outputTokens * (m.priceOut ?? 0));
}

/** About what one message costs on a model, in micro-dollars. */
export function perMessageMicros(m: Pick<ModelDef, "priceIn" | "priceOut">): number {
  return tokensMicros(m, TYPICAL_MESSAGE);
}

/** 2,380 → "2,400": a count rounded to two significant digits, for "about N messages". */
export function about(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const step = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / step) * step).toLocaleString("en-US");
}

/** Credit you can add at once, in dollars. */
export const TOP_UPS_USD = [5, 10, 20] as const;

/**
 * Demo mode adds credit without paying, up to this much per account: a demo site with real keys
 * still pays for what's used (the site's daily ceilings bound the rest).
 */
export const DEMO_CREDIT_CAP_USD = 20;
export type TopUpUsd = (typeof TOP_UPS_USD)[number];

/** Stripe's fee for a US card: 2.9% plus 30¢. */
export const CARD_FEE = { percent: 2.9, fixedCents: 30 } as const;

/** What the card is charged for `creditUsd` of credit: the credit, plus Stripe's fee on the whole charge. */
export function topUpChargeCents(creditUsd: number): number {
  const credit = Math.round(creditUsd * 100);
  return Math.ceil((credit + CARD_FEE.fixedCents) / (1 - CARD_FEE.percent / 100));
}

/**
 * Not prices: the same guard rails for everyone, so one account can't run away with the servers.
 * Money is what limits use; these are generous on purpose.
 */
export const FAIR_USE = {
  bots: 10,
  /** Apps connected to one bot (the built-ins don't count). */
  appsPerBot: 200,
  /** Routines switched on, on one bot. */
  routines: 200,
  /** Messages a month on your own AI key (free here, but they still use our servers). */
  ownBrainMessages: 100_000,
} as const;

/** Messages on an included model before an account confirms an email (accounts are free to make). */
export const ANONYMOUS_INCLUDED_MESSAGES = 5;

/** Under this much credit left (25¢), Credit & usage and the sidebar say it's running low. */
export const LOW_CREDIT_MICROS = 250_000;

/** How a balance should look: fine, running low, or out. */
export function creditTone(balanceMicros: number): "primary" | "warning" | "danger" {
  return balanceMicros <= 0 ? "danger" : balanceMicros < LOW_CREDIT_MICROS ? "warning" : "primary";
}

/** "$4.37", "$0.00042", "−$0.0021", "$0.00": a balance or a price, with enough digits to see small amounts. */
export function formatMicros(micros: number): string {
  const sign = micros < 0 ? "−" : "";
  const usd = Math.abs(micros) / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd >= 0.1) return `${sign}$${usd.toFixed(2)}`;
  // Under a dime: up to three significant digits, so $0.00042 doesn't show as $0.00.
  const digits = Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(usd))));
  return `${sign}$${usd.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1")}`;
}

/** "$5.46" from cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "$0.06 / $0.24": a model's price for a million tokens in and out. */
export function perMillionLabel(m: Pick<ModelDef, "priceIn" | "priceOut">): string {
  return `$${(m.priceIn ?? 0).toFixed(2)} / $${(m.priceOut ?? 0).toFixed(2)}`;
}
