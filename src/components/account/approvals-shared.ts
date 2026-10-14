/**
 * Shapes shared by the Approvals page (server) and ApprovalsBoard (client).
 * No "use client" here: the server page calls readResult() directly.
 */
import type * as React from "react";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import type { WebFormPreview } from "@/lib/web-actions/types";

export type ApprovalBot = { id: string; name: string; avatar: AvatarId; color: ColorwayId; paused: boolean; trustName: string };
export type ApprovalField = { label: string; value: string; long: boolean };
export type ApprovalResult = { ok: boolean | null; text: string | null };
export type ApprovalItem = {
  id: string;
  botId: string;
  title: string;
  risk: string;
  reasons: string[];
  status: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedVia: string | null;
  fields: ApprovalField[];
  /** Web form submits: exactly what will be sent, with a picture of the filled form. */
  webForm?: WebFormPreview | null;
  result: ApprovalResult | null;
  app: { name: string; icon: React.ReactNode } | null;
};

/** approvals.result is `{ ok, text }` after running, or `{ error }` when it couldn't run. */
export function readResult(raw: unknown): ApprovalResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { ok?: unknown; text?: unknown; error?: unknown };
  const text = typeof r.text === "string" ? r.text : typeof r.error === "string" ? r.error : null;
  return { ok: typeof r.ok === "boolean" ? r.ok : null, text };
}
