import { clientMetadataDocument } from "@/lib/connectors/mcp/oauth";

/** Client ID Metadata Document: our client_id for MCP servers that support CIMD. */
export function GET() {
  return Response.json(clientMetadataDocument(), { headers: { "cache-control": "public, max-age=3600" } });
}
