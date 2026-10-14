import type { IconSpec } from "@/components/brand/icons";

export const ACTIVITY_FILTERS = ["all", "actions", "messages", "approvals", "settings"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

/** A receipt as the browser sees it (dates as ISO strings). */
export type ReceiptView = {
  id: string;
  kind: string;
  status: string;
  title: string;
  detail: Record<string, unknown>;
  costMicros: number;
  createdAt: string;
};

export type AppInfo = { name: string; icon: IconSpec };

export type DeliveryView = {
  id: string;
  channelKind: string;
  to: string;
  subject: string | null;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
};
