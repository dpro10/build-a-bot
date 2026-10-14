/**
 * Filled-but-not-sent web forms, kept between the fill step and the owner's approval.
 *
 * Rows live in the short-lived codes table (pairing_codes, purpose "web_session"),
 * the same table approvals.ts uses for button keys:
 *  - one row per fill, scoped to a bot and its owner;
 *  - it expires with the cloud browser session;
 *  - it's one-shot: `usedAt` is set the moment a submit starts, so nothing is sent twice;
 *  - housekeeping (scheduler/tick.ts) deletes rows a week after they expire.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { newId } from "@/lib/utils";
import type { FilledField, WebField } from "./types";

const PURPOSE = "web_session";

/** Screenshot types we store and serve (never SVG, which can carry script). */
export const RASTER = /^image\/(png|jpeg|webp)$/;

export type WebSessionData = {
  provider: "browser-use" | "demo";
  providerSessionId: string;
  url: string;
  site: string;
  title?: string;
  /** What the browser says it typed: shown in the preview and re-checked before sending. */
  fields: FilledField[];
  /** What the bot asked for, placeholders resolved. */
  requested: WebField[];
  notes?: string;
  /** Real screenshot of the filled form (live provider), served by readWebSessionScreenshot. */
  screenshot?: { contentType: string; base64: string };
  /** Drawn preview (demo provider): a data: URL small enough to inline on the approval. */
  previewDataUrl?: string;
  liveUrl?: string;
  simulated: boolean;
  submitted?: { at: string; ok: boolean; confirmation?: string; error?: string };
};

export type WebSession = WebSessionData & {
  id: string;
  botId: string;
  ownerId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

type Row = typeof schema.pairingCodes.$inferSelect;

function toSession(row: Row): WebSession {
  const data = row.data as unknown as WebSessionData;
  return { ...data, id: row.code, botId: row.botId ?? "", ownerId: row.ownerId, createdAt: row.createdAt, expiresAt: row.expiresAt, usedAt: row.usedAt };
}

export function isWebSessionId(id: unknown): id is string {
  return typeof id === "string" && /^wss_[a-z0-9]{8,32}$/.test(id);
}

export async function saveWebSession(
  db: Db,
  input: { botId: string; ownerId: string; expiresAt: Date; data: WebSessionData },
): Promise<WebSession> {
  const [row] = await db
    .insert(schema.pairingCodes)
    .values({
      code: newId("wss"),
      purpose: PURPOSE,
      ownerId: input.ownerId,
      botId: input.botId,
      data: input.data as unknown as Record<string, unknown>,
      expiresAt: input.expiresAt,
    })
    .returning();
  return toSession(row);
}

/** One of this bot's sessions by id (any state), or null. */
export async function getWebSession(db: Db, botId: string, id: string): Promise<WebSession | null> {
  if (!isWebSessionId(id)) return null;
  const [row] = await db
    .select()
    .from(schema.pairingCodes)
    .where(and(eq(schema.pairingCodes.code, id), eq(schema.pairingCodes.purpose, PURPOSE), eq(schema.pairingCodes.botId, botId)))
    .limit(1);
  return row ? toSession(row) : null;
}

/** The bot's most recent filled form that's still open and unsent. */
export async function latestOpenWebSession(db: Db, botId: string, now = new Date()): Promise<WebSession | null> {
  const [row] = await db
    .select()
    .from(schema.pairingCodes)
    .where(
      and(
        eq(schema.pairingCodes.purpose, PURPOSE),
        eq(schema.pairingCodes.botId, botId),
        isNull(schema.pairingCodes.usedAt),
        gt(schema.pairingCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.pairingCodes.createdAt))
    .limit(1);
  return row ? toSession(row) : null;
}

/** By id when given, else the latest open one. */
export async function findWebSession(db: Db, botId: string, id?: string | null): Promise<WebSession | null> {
  return id ? getWebSession(db, botId, id) : latestOpenWebSession(db, botId);
}

/** Marks a session used, atomically. Null if it's gone, expired or already used. */
export async function claimWebSession(db: Db, botId: string, id: string, now = new Date()): Promise<WebSession | null> {
  const [row] = await db
    .update(schema.pairingCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.pairingCodes.code, id),
        eq(schema.pairingCodes.purpose, PURPOSE),
        eq(schema.pairingCodes.botId, botId),
        isNull(schema.pairingCodes.usedAt),
        gt(schema.pairingCodes.expiresAt, now),
      ),
    )
    .returning();
  return row ? toSession(row) : null;
}

export async function recordSubmitResult(db: Db, id: string, submitted: NonNullable<WebSessionData["submitted"]>) {
  await db
    .update(schema.pairingCodes)
    .set({ data: sql`${schema.pairingCodes.data} || ${JSON.stringify({ submitted })}::jsonb` })
    .where(and(eq(schema.pairingCodes.code, id), eq(schema.pairingCodes.purpose, PURPOSE)));
}

/** Same-origin path the approval card loads the real screenshot from (see readWebSessionScreenshot). */
export function webSessionPreviewPath(id: string): string {
  return `/api/web-actions/${id}/preview`;
}

/**
 * The real screenshot of a filled form (PNG/JPEG/WebP only), for its owner only. Backs
 * `GET /api/web-actions/[sessionId]/preview`: authed() → this → an image response with
 * `X-Content-Type-Options: nosniff`. Demo previews are inline data: URLs and never served here.
 */
export async function readWebSessionScreenshot(db: Db, ownerId: string, id: string): Promise<{ contentType: string; body: Buffer } | null> {
  if (!isWebSessionId(id)) return null;
  const [row] = await db
    .select()
    .from(schema.pairingCodes)
    .where(and(eq(schema.pairingCodes.code, id), eq(schema.pairingCodes.purpose, PURPOSE), eq(schema.pairingCodes.ownerId, ownerId)))
    .limit(1);
  const shot = row ? toSession(row).screenshot : undefined;
  if (!shot || !RASTER.test(shot.contentType)) return null;
  return { contentType: shot.contentType, body: Buffer.from(shot.base64, "base64") };
}
