/**
 * robots.txt and sitemap.xml are built per request, from the address the site runs at
 * (APP_URL, else Vercel's production domain), never from wherever the build happened.
 */
import { afterEach, describe, expect, it } from "vitest";

const robots = await import("@/app/robots");
const sitemap = await import("@/app/sitemap");

const saved = { APP_URL: process.env.APP_URL, VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL: process.env.VERCEL_URL };

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("robots.txt and sitemap.xml", () => {
  it("aren't frozen at build time", () => {
    expect(robots.dynamic).toBe("force-dynamic");
    expect(sitemap.dynamic).toBe("force-dynamic");
  });

  it("use APP_URL where the site runs", () => {
    process.env.APP_URL = "https://build-a-bot.site/";
    expect(robots.default().sitemap).toBe("https://build-a-bot.site/sitemap.xml");
    expect(sitemap.default().map((p) => p.url)).toContain("https://build-a-bot.site/pricing");
  });

  it("fall back to Vercel's production domain", () => {
    delete process.env.APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "build-a-bot-blue.vercel.app";
    expect(robots.default().sitemap).toBe("https://build-a-bot-blue.vercel.app/sitemap.xml");
    expect(sitemap.default()[0].url).toBe("https://build-a-bot-blue.vercel.app/");
  });
});
