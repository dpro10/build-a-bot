import type { ChannelKind } from "@/lib/channels/catalog";

export type ActionData = Record<string, unknown>;

/** What every channel card body gets from the page. */
export type ChannelCtx = {
  botId: string;
  botName: string;
  demo: boolean;
  ownerEmail: string | null;
  /** The bot's own email address (brand-free handle), when bots get inboxes here. */
  botEmail: string | null;
  /** The shared "Add to Slack" app is set up here: Slack is one click. */
  slackOneClick: boolean;
  /** Runs a channel setup action; resolves null after showing the error. */
  run: (kind: ChannelKind, action: string, payload?: Record<string, unknown>) => Promise<ActionData | null>;
  refresh: () => Promise<void>;
  /** Poll for a few minutes: something outside the app (Telegram, Slack, Discord) will finish setup. */
  expect: (kind: ChannelKind) => void;
};

export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
