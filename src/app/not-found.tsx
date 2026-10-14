import type { Metadata } from "next";
import { NotFoundContent } from "@/components/marketing/NotFoundContent";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";

// Next.js adds its own noindex tag to 404 responses.
export const metadata: Metadata = {
  title: "Page not found",
};

/** Unmatched URLs anywhere on the site. (The public pages have their own not-found inside the marketing layout.) */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        <NotFoundContent />
      </main>
      <SiteFooter />
    </div>
  );
}
