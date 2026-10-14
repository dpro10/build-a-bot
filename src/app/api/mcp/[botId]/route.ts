import { handleMcpRequest } from "@/lib/mcp-server";
import type { RouteCtx } from "@/lib/api";

export const maxDuration = 120;

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  return handleMcpRequest(req, botId);
}

const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
