import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Bot, MessagePart, User } from "@/lib/db/schema";
import type { Effect, Risk } from "@/lib/connectors/types";
import type { Recipient } from "@/lib/policy/engine";
import type { JsonSchema } from "@/lib/llm/types";

export type ToolContext = {
  db: Db;
  bot: Bot;
  owner: User;
  conversationId: string | null;
  channelKind: string;
  /** Simulate external services (no keys / demo mode). */
  demo: boolean;
  now: Date;
  signal?: AbortSignal;
  /** This turn has read outside content (an email, a web page, someone else's message). */
  tainted?: boolean;
};

export type ToolSource = { title: string; url: string };

export type ToolOutput =
  | {
      ok: true;
      content: string;
      summary?: string;
      data?: unknown;
      sources?: ToolSource[];
      /** Something to show with the reply (flashcards or a quiz to study). */
      card?: Extract<MessagePart, { type: "study_set" }>;
      /** Paid lookups it really made (Tavily searches that answered), when that's not one. */
      lookups?: number;
    }
  | { ok: false; error: string };

export type ToolSpec<A extends Record<string, unknown> = Record<string, unknown>> = {
  /** Model-facing name: ^[a-zA-Z0-9_-]{1,64}$ */
  name: string;
  /** Short human label for the UI ("Search the web"). */
  title: string;
  description: string;
  input: z.ZodType<A>;
  connectorId: string;
  capabilityId?: string;
  effect: Effect;
  risk: Risk;
  sensitive?: boolean;
  /** Output may carry text written by someone other than the owner (prompt-injection risk). */
  taints?: boolean;
  /** Only ever reaches the owner (e.g. "text me when done"): allowed unless paused. */
  ownerOnly?: boolean;
  recipients?: (args: A, ctx: ToolContext) => Promise<Recipient[]> | Recipient[];
  amountUsd?: (args: A) => number | undefined;
  itemCount?: (args: A) => number | undefined;
  outboundText?: (args: A) => string | undefined;
  /** One line the owner reads on an approval card or receipt. */
  summarize: (args: A) => string;
  run: (args: A, ctx: ToolContext) => Promise<ToolOutput>;
  /** Pre-computed JSON schema (MCP/Composio tools come with their own). */
  jsonSchema?: JsonSchema;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolSpec = ToolSpec<any>;

export function defineTool<A extends Record<string, unknown>>(spec: ToolSpec<A>): ToolSpec<A> {
  return spec;
}

/** JSON schema for a tool's input, without the $schema key models don't want. */
export function toolJsonSchema(spec: AnyToolSpec): JsonSchema {
  if (spec.jsonSchema) return spec.jsonSchema;
  const schema = z.toJSONSchema(spec.input, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  if (schema.type !== "object") return { type: "object", properties: {}, additionalProperties: true };
  return schema;
}

export function safeToolName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
