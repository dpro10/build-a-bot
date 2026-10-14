import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";
import { FEATURED_RECIPES } from "@/lib/recipes";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const updated = new Date(`${SITE.legalUpdatedISO}T00:00:00Z`);
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" | "yearly" = "weekly"): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified: updated,
    changeFrequency,
    priority,
  });
  return [
    page("/", 1),
    page("/build", 0.9),
    page("/pricing", 0.8),
    page("/explore", 0.8),
    page("/safety", 0.7, "monthly"),
    page("/legal/terms", 0.3, "yearly"),
    page("/legal/privacy", 0.3, "yearly"),
    ...FEATURED_RECIPES.map((r) => page(`/r/${r.slug}`, 0.6, "monthly")),
  ];
}
