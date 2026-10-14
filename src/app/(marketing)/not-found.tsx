import { NotFoundContent } from "@/components/marketing/NotFoundContent";

/**
 * notFound() from a public page (say, /r/a-recipe-that-was-deleted). The marketing
 * layout around it already has the header, <main> and footer.
 */
export default function MarketingNotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col">
      <NotFoundContent body="This page doesn't exist, or it moved. If someone shared a recipe link with you, they may have stopped sharing it." />
    </div>
  );
}
