import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

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
