/**
 * Paired computers: the desktop app (meeting notes, voice typing, the Library). It pairs with a
 * code (POST /api/bridge/pair), then calls in with its device token (auth.ts). The "bridge" name
 * is where pairing began: computers first paired to run the Bridge (bots on the owner's own
 * Claude or ChatGPT plan), which is gone since 2026-10-20.
 */

/** A computer counts as online when it called in this recently. */
export const DEVICE_ONLINE_MS = 90_000;
