import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

// Built per request, not at build time: the sitemap's address follows APP_URL where the site
// runs (a build made elsewhere would bake in its own, like http://localhost:3000).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = appUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private app pages, APIs, sign-in and OAuth plumbing aren't for search engines.
        disallow: ["/app/", "/api/", "/login", "/auth/", "/oauth/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
