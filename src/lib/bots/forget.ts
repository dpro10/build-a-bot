/**
 * Before bots are deleted: sign them out of the apps they used (Composio forgets those sign-ins
 * too) and delete the keys they held for apps and channels (Telegram and Slack tokens). The rows
 * that point at those keys go with the bots; the keys themselves belong to the account.
 */
import { inArray } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { revokeComposioConnection } from "@/lib/connectors/composio";

export async function forgetBotSecrets(db: Db, botIds: string[]): Promise<void> {
  if (!botIds.length) return;
  const connections = await db.select().from(schema.connections).where(inArray(schema.connections.botId, botIds));
  const channels = await db.select({ credentialId: schema.channels.credentialId }).from(schema.channels).where(inArray(schema.channels.botId, botIds));
  for (const c of connections) if (c.mode === "composio") await revokeComposioConnection(c);
  const keys = [...connections, ...channels].map((r) => r.credentialId).filter((id): id is string => Boolean(id));
  if (keys.length) await db.delete(schema.credentials).where(inArray(schema.credentials.id, keys));
}
