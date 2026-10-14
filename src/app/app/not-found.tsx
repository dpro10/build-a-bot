import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";

/** A missing bot, meeting or page inside the app: stays in the app, sidebar and all. */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <Avatar avatar="otto" color="grape" size={112} mood="thinking" />
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">Not found</p>
        <h1 className="font-display text-2xl font-bold">We couldn&apos;t find that</h1>
        <p className="text-muted-foreground">It may have been deleted, or it belongs to a different account. Your own bots are right where you left them.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/app?all=1">
            Your bots <ArrowRight />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/build">
            <Plus /> New bot
          </Link>
        </Button>
      </div>
    </div>
  );
}
