/**
 * Who is looking at a public page: enough to swap "Sign in" for "Your bots".
 * Cached per request so the header and the page share one lookup. A database
 * hiccup must not take the marketing site down, so app errors fall back to
 * "signed out"; Next.js's own control-flow errors are rethrown.
 */
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { getUser, isAnonymous } from "@/lib/auth/session";

export type Viewer = { id: string; anonymous: boolean; plan: string };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  try {
    const user = await getUser();
    if (!user) return null;
    return { id: user.id, anonymous: isAnonymous(user), plan: user.plan };
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
});
