/**
 * Small helpers for route handlers: JSON responses, auth, body parsing.
 */
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import type { Bot, User } from "@/lib/db/schema";
import { getUser } from "@/lib/auth/session";
import { getOwnedBot } from "@/lib/data";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function parseJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: apiError(400, "Invalid JSON body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, res: apiError(422, issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid input") };
  }
  return { ok: true, data: parsed.data };
}

export async function authed(): Promise<{ ok: true; user: User; db: Db } | { ok: false; res: Response }> {
  const user = await getUser();
  if (!user) return { ok: false, res: apiError(401, "Sign in first") };
  return { ok: true, user, db: await getDb() };
}

export async function authedBot(botId: string): Promise<{ ok: true; user: User; db: Db; bot: Bot } | { ok: false; res: Response }> {
  const a = await authed();
  if (!a.ok) return a;
  const bot = await getOwnedBot(a.db, a.user.id, botId);
  if (!bot) return { ok: false, res: apiError(404, "Bot not found") };
  return { ok: true, user: a.user, db: a.db, bot };
}

/** Same-origin check for state-changing requests from browsers (defense in depth vs CSRF). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type RouteCtx<P extends Record<string, string>> = { params: Promise<P> };
