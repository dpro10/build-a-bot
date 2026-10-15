/**
 * Composio toolkits in our catalog that Composio can't sign people in to with its own OAuth app
 * (its toolkits.json, versions up to 2026-10-10):
 *  - "oauth_app": needs an OAuth app of our own, registered with the vendor and added in Composio;
 *  - "api_key":   the person would have to bring their own key for that service;
 *  - "none":      no sign-in at all (not wired up here yet).
 * Until one of those is set up, such an app connects only through another route in its catalog
 * entry (an MCP server), or shows as Coming soon. An auth config made in Composio's dashboard and
 * set as COMPOSIO_AUTH_CONFIG_<TOOLKIT> makes it usable.
 */
export const COMPOSIO_UNMANAGED: Readonly<Record<string, "oauth_app" | "api_key" | "none">> = {
  apify: "api_key",
  bestbuy: "api_key",
  blackboard: "oauth_app",
  browserbase_tool: "api_key",
  buffer: "oauth_app",
  canvas: "api_key",
  cloudflare: "api_key",
  coinbase: "api_key",
  context7_mcp: "api_key",
  datadog: "api_key",
  deepwiki_mcp: "none",
  elevenlabs: "api_key",
  exa: "api_key",
  firecrawl: "api_key",
  fireflies: "api_key",
  freshdesk: "api_key",
  gamma: "api_key",
  google_chat: "oauth_app",
  googlecontacts: "oauth_app",
  googleforms: "oauth_app",
  granola_mcp: "oauth_app",
  hackernews: "none",
  klaviyo: "api_key",
  make: "api_key",
  metaads: "api_key",
  microsoft_todo: "oauth_app",
  mixpanel: "api_key",
  netlify_mcp: "oauth_app",
  onenote: "oauth_app",
  openai: "api_key",
  paypal: "oauth_app",
  perplexityai: "api_key",
  pipedrive: "api_key",
  posthog: "api_key",
  raindrop: "api_key",
  readwise_reader: "api_key",
  replicate: "api_key",
  semanticscholar: "api_key",
  shopify: "oauth_app",
  soundcloud: "oauth_app",
  spotify: "oauth_app",
  survey_monkey: "api_key",
  telegram: "api_key",
  tiktok: "oauth_app",
  tripadvisor: "api_key",
  trivago_mcp: "none",
  twitter: "oauth_app",
  vercel: "api_key",
  webflow: "api_key",
  wise: "api_key",
  wix: "api_key",
  wolfram_alpha_api: "api_key",
  wordpress_com: "oauth_app",
  xero: "oauth_app",
  yelp: "none",
};

/** Whether Composio can sign people in to this toolkit right now. */
export function composioCanConnect(toolkit: string): boolean {
  if (process.env[`COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`]?.trim()) return true;
  return !(toolkit in COMPOSIO_UNMANAGED);
}
