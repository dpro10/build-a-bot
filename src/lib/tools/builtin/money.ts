import { z } from "zod";
import { defineTool } from "../types";
import { calculate } from "../calc";
import { fetchWithTimeout, USER_AGENT } from "../net";

const DEMO_RATES_PER_USD: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.5, CAD: 1.37, MXN: 18.4, AUD: 1.52, INR: 83.6, CNY: 7.2, CHF: 0.88, BRL: 5.4, KRW: 1360,
};

export const convertCurrency = defineTool({
  name: "convert_currency",
  title: "Convert currency",
  description: "Convert an amount between currencies using today's reference exchange rates.",
  input: z.object({
    amount: z.number().describe("Amount to convert"),
    from: z.string().length(3).describe("ISO currency code, e.g. USD"),
    to: z.string().length(3).describe("ISO currency code, e.g. EUR"),
  }),
  connectorId: "currency",
  capabilityId: "convert",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: (a) => `Convert ${a.amount} ${a.from.toUpperCase()} → ${a.to.toUpperCase()}`,
  async run(args, ctx) {
    const from = args.from.toUpperCase();
    const to = args.to.toUpperCase();
    try {
      const res = await fetchWithTimeout(
        `https://api.frankfurter.app/latest?amount=${encodeURIComponent(String(args.amount))}&from=${from}&to=${to}`,
        { headers: { "user-agent": USER_AGENT }, signal: ctx.signal, timeoutMs: 8000 },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { date: string; rates: Record<string, number> };
      const value = data.rates[to];
      if (value === undefined) return { ok: false, error: `No rate for ${from} → ${to}.` };
      return { ok: true, content: `${args.amount} ${from} = ${value.toFixed(2)} ${to} (reference rate, ${data.date})`, summary: `${value.toFixed(2)} ${to}` };
    } catch {
      if (!ctx.demo) return { ok: false, error: "The exchange-rate service didn't answer." };
      const a = DEMO_RATES_PER_USD[from];
      const b = DEMO_RATES_PER_USD[to];
      if (!a || !b) return { ok: false, error: `Unknown currency ${!a ? from : to}.` };
      const value = (args.amount / a) * b;
      return { ok: true, content: `${args.amount} ${from} ≈ ${value.toFixed(2)} ${to} (approximate demo rate)`, summary: `${value.toFixed(2)} ${to}` };
    }
  },
});

export const calculateTool = defineTool({
  name: "calculate",
  title: "Do the math",
  description: "Evaluate arithmetic exactly (tips, splits, percentages, unit math). Supports + - * / % ^ ( ) sqrt round min max.",
  input: z.object({ expression: z.string().min(1).max(300).describe("e.g. '(84.20 * 1.18) / 3'") }),
  connectorId: "currency",
  capabilityId: "convert",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: (a) => `Calculate ${a.expression}`,
  async run(args) {
    try {
      const value = calculate(args.expression);
      const pretty = Number.isInteger(value) ? String(value) : String(Math.round(value * 1e8) / 1e8);
      return { ok: true, content: `${args.expression} = ${pretty}`, summary: pretty };
    } catch (err) {
      return { ok: false, error: `Couldn't calculate that: ${(err as Error).message}` };
    }
  },
});
