import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Channel } from "@/lib/db/schema";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto";
import { newId } from "@/lib/utils";

export async function readCredential(db: Db, credentialId: string | null | undefined): Promise<string | null> {
  if (!credentialId) return null;
  const [row] = await db.select().from(schema.credentials).where(eq(schema.credentials.id, credentialId)).limit(1);
  if (!row) return null;
  try {
    return decryptSecret(row.secret);
  } catch {
    return null;
  }
}

export async function channelSecret(db: Db, channel: Channel | null): Promise<string | null> {
  return readCredential(db, channel?.credentialId);
}

export async function storeCredential(
  db: Db,
  input: { ownerId: string; kind: string; provider: string; secret: string; label?: string; meta?: Record<string, unknown>; expiresAt?: Date | null },
): Promise<string> {
  const id = newId("cred");
  await db.insert(schema.credentials).values({
    id,
    ownerId: input.ownerId,
    kind: input.kind,
    provider: input.provider,
    label: input.label ?? null,
    secret: encryptSecret(input.secret),
    hint: secretHint(input.secret),
    meta: input.meta ?? {},
    expiresAt: input.expiresAt ?? null,
  });
  return id;
}

export async function replaceCredential(db: Db, credentialId: string, secret: string, expiresAt?: Date | null) {
  await db
    .update(schema.credentials)
    .set({ secret: encryptSecret(secret), hint: secretHint(secret), updatedAt: new Date(), ...(expiresAt !== undefined ? { expiresAt } : {}) })
    .where(eq(schema.credentials.id, credentialId));
}
