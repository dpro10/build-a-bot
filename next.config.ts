import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files it loads from disk; postgres.js uses Node sockets.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  poweredByHeader: false,
  // AGENTS.md is the Cookbook workspace's file; don't let `next dev` append to it.
  agentRules: false,
  // Local data (the dev database and the dev encryption key) must never ship in a server bundle.
  outputFileTracingExcludes: { "*": [".data/**", "e2e/**", "tests/**", "docs/**", "bridge/**"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
