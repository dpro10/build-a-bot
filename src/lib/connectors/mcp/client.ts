/**
 * Minimal MCP client over Streamable HTTP (2025 "legacy" protocol, which every
 * dual-era server accepts). Stateless use: initialize → initialized → one request.
 * Handles JSON and SSE responses and surfaces 401 challenges for OAuth.
 */
import { publicFetch, UnsafeUrlError } from "@/lib/tools/net";

export const MCP_CLIENT_VERSION = "2025-11-25";
const CLIENT_INFO = { name: "build-a-bot", title: "Build-a-bot", version: "1.0.0" };

export class McpAuthRequired extends Error {
  constructor(
    readonly wwwAuthenticate: string | null,
    readonly status: number,
  ) {
    super(status === 403 ? "MCP server needs more permissions" : "MCP server needs sign-in");
    this.name = "McpAuthRequired";
  }
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
};

export type McpCallResult = {
  content?: { type: string; text?: string; mimeType?: string; uri?: string; resource?: { text?: string; uri?: string } }[];
  structuredContent?: unknown;
  isError?: boolean;
};

type Conn = { url: string; token?: string | null; headers?: Record<string, string> };

let rpcId = 0;

/** How long a server has to answer, and how much it may send: one that streams forever or floods can't hang a bot's turn. */
const ANSWER_TIMEOUT_MS = 30_000;
const ANSWER_MAX_BYTES = 4_000_000;

type RpcMessage = { result?: unknown; error?: { code: number; message: string } };

/**
 * Reads the answer, a piece at a time, within ANSWER_TIMEOUT_MS and ANSWER_MAX_BYTES. On an event
 * stream, it stops at the event that answers this request (a server may keep the stream open).
 */
export async function readRpcResponse(res: Response, id: number): Promise<RpcMessage> {
  const stream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  const reader = res.body?.getReader();
  if (!reader) throw new McpError(`Empty response (${res.status})`);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, ANSWER_TIMEOUT_MS);
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  const answerIn = (blocks: string[]): RpcMessage | null => {
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data: ?/, ""))
        .join("\n");
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (msg && msg.id === id) return msg;
      } catch {
        /* skip non-JSON events */
      }
    }
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ANSWER_MAX_BYTES) throw new McpError("The server's answer was too large.");
      text += decoder.decode(value, { stream: true });
      if (stream) {
        const blocks = text.split(/\r?\n\r?\n/);
        text = blocks.pop() ?? "";
        const found = answerIn(blocks);
        if (found) return found;
      }
    }
    if (timedOut) throw new McpError("The server took too long to answer.");
    text += decoder.decode();
    if (stream) {
      const found = answerIn([text]);
      if (found) return found;
      throw new McpError("No response in event stream");
    }
    try {
      const body = JSON.parse(text) as RpcMessage | null;
      if (body) return body;
    } catch {
      /* not JSON */
    }
    throw new McpError(`Empty response (${res.status})`);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

async function post(conn: Conn, payload: Record<string, unknown>, sessionId: string | null, protocol: string | null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "Build-a-bot/1.0 (+https://build-a-bot.site)",
    ...(conn.headers ?? {}),
  };
  if (conn.token) headers.authorization = `Bearer ${conn.token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocol) headers["mcp-protocol-version"] = protocol;
  // The server's address is someone's choice (your own MCP server): public addresses only, every redirect checked.
  const res = await publicFetch(conn.url, { method: "POST", headers, body: JSON.stringify(payload), timeoutMs: 25000 }).catch((err) => {
    throw err instanceof UnsafeUrlError ? new McpError(`Can't reach that server: ${err.message}`) : err;
  });
  if (res.status === 401 || res.status === 403) {
    throw new McpAuthRequired(res.headers.get("www-authenticate"), res.status);
  }
  return res;
}

/** Open a session (if the server wants one) and return a request function. */
async function open(conn: Conn) {
  const id = ++rpcId;
  const initRes = await post(
    conn,
    { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: MCP_CLIENT_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } },
    null,
    null,
  );
  if (!initRes.ok) throw new McpError(`initialize failed (${initRes.status})`);
  const sessionId = initRes.headers.get("mcp-session-id");
  const init = await readRpcResponse(initRes, id);
  if (init.error) throw new McpError(init.error.message, init.error.code);
  const protocol = (init.result as { protocolVersion?: string })?.protocolVersion ?? MCP_CLIENT_VERSION;
  await post(conn, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, protocol).catch(() => undefined);

  return async function request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const rid = ++rpcId;
    const res = await post(conn, { jsonrpc: "2.0", id: rid, method, params }, sessionId, protocol);
    if (!res.ok && res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      throw new McpError(`${method} failed (${res.status})`);
    }
    const msg = await readRpcResponse(res, rid);
    if (msg.error) throw new McpError(msg.error.message, msg.error.code);
    return msg.result as T;
  };
}

export async function listTools(conn: Conn): Promise<McpTool[]> {
  const request = await open(conn);
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await request<{ tools: McpTool[]; nextCursor?: string }>("tools/list", cursor ? { cursor } : {});
    tools.push(...(res.tools ?? []));
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return tools;
}

export async function callTool(conn: Conn, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const request = await open(conn);
  return request<McpCallResult>("tools/call", { name, arguments: args });
}

/** Flatten an MCP tool result into text for the model. */
export function resultText(result: McpCallResult, max = 12000): string {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && block.text) parts.push(block.text);
    else if (block.type === "resource" && block.resource?.text) parts.push(block.resource.text);
    else if (block.type === "resource_link" && block.uri) parts.push(`[link] ${block.uri}`);
    else if (block.type === "image" || block.type === "audio") parts.push(`[${block.type} omitted]`);
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n\n");
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

/** Parse `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`. */
export function parseWwwAuthenticate(header: string | null): { resourceMetadata?: string; scope?: string; error?: string } {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return { resourceMetadata: out.resource_metadata, scope: out.scope, error: out.error };
}
