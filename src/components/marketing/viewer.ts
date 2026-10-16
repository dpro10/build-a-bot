/**
 * Who is looking at a public page: enough to swap "Sign in" for "Your bots".
 * Cached per request so the header and the page share one lookup. A database
 * hiccup must not take the marketing site down, so app errors fall back to
 * "signed out"; Next.js's own control-flow errors are rethrown.
 */
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { getUser, isAnonymous } from "@/lib/auth/session";

/** `email` is their confirmed address (null until they've signed in with one). */
export type Viewer = { id: string; anonymous: boolean; email: string | null };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  try {
    const user = await getUser();
    if (!user) return null;
    const anonymous = isAnonymous(user);
    return { id: user.id, anonymous, email: anonymous ? null : user.email };
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
});
