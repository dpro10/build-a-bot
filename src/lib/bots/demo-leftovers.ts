/**
 * Out of demo mode, what was simulated in it needs a real setup. Apps connected with sample data
 * ask for a real sign-in (the tool registry already stops serving their sample data there), and
 * channels that ran simulated go back to "set up": nothing was ever really sent through them, and
 * their stand-in addresses ("@otto_bot", "Demo workspace") mustn't stay on them. Runs with
 * housekeeping (every minute on Vercel); in demo mode, or once nothing is left over, it does nothing.
 */
import { eq, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { demoMode } from "@/lib/env";
import { getConnector } from "@/lib/connectors";
import { connectVia } from "@/lib/connectors/availability";

export async function leaveDemoMode(db: Db): Promise<{ apps: number; channels: number }> {
  if (demoMode) return { apps: 0, channels: 0 };

  const apps = await db
    .select()
    .from(schema.connections)
    .where(or(eq(schema.connections.status, "demo"), eq(schema.connections.mode, "demo")));
  for (const app of apps) {
    // As the app would be added now (connections route): the way to sign in to it here, if there is one.
    const def = getConnector(app.connectorId);
    const via = def ? connectVia(def) : undefined;
    const route =
      via?.kind === "mcp" ? { url: via.url, auth: via.auth, ...(via.headers ? { headers: via.headers } : {}) } : via?.kind === "composio" ? { toolkit: via.toolkit } : {};
    await db
      .update(schema.connections)
      .set({
        // One connected for real whose mode was never updated keeps its sign-in.
        status: app.status === "demo" ? "needs_auth" : app.status,
        mode: via?.kind === "composio" ? "composio" : "mcp",
        config: { ...app.config, ...route },
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.connections.id, app.id));
  }

  const channels = await db
    .select({ id: schema.channels.id, config: schema.channels.config })
    .from(schema.channels)
    .where(sql`${schema.channels.config} ->> 'simulated' = 'true'`);
  for (const ch of channels) {
    // What the owner typed for the real setup stays; the stand-in handle goes.
    const { simulated: _s, username: _u, ...config } = ch.config;
    await db
      .update(schema.channels)
      .set({ status: "needs_setup", address: null, ownerAddress: null, ownerVerifiedAt: null, config, error: null, updatedAt: new Date() })
      .where(eq(schema.channels.id, ch.id));
  }

  if (apps.length || channels.length) console.log(`[demo] out of demo mode: ${apps.length} simulated apps now need a real sign-in, ${channels.length} simulated channels a real setup`);
  return { apps: apps.length, channels: channels.length };
}
