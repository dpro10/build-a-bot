import type { ChannelKind } from "@/lib/channels/catalog";

export type ActionData = Record<string, unknown>;

/** What every channel card body gets from the page. */
export type ChannelCtx = {
  botId: string;
  botName: string;
  demo: boolean;
  ownerEmail: string | null;
  /** The bot's own email address (brand-free handle). */
  botEmail: string;
  /** Runs a channel setup action; resolves null after showing the error. */
  run: (kind: ChannelKind, action: string, payload?: Record<string, unknown>) => Promise<ActionData | null>;
  refresh: () => Promise<void>;
  /** Poll for a few minutes: something outside the app (Telegram, Slack, Discord) will finish setup. */
  expect: (kind: ChannelKind) => void;
};

export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
