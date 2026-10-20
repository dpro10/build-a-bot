/**
 * The contract between the desktop app (desktop/, Electron) and the buddy page it
 * shows at the bottom of the screen (/desktop/buddy). The desktop app's preload
 * script puts `window.babDesktop` on that page; the page never gets Node, tokens or
 * files, only this small surface.
 *
 * Window sizes the desktop app uses per phase (the page is anchored bottom-center,
 * transparent, and only catches the mouse over the bot and its bubble):
 *   asking 440×330 · listening/paused 840×200 (the pill grows to the right of the
 *   centered bot when hovered) · saving/done/error 420×230
 *
 * Clickable parts carry `data-buddy-interactive`, so a desktop app that can't get
 * hover events from the OS (Linux) can hit-test them itself.
 */
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import type { MeetingAppId } from "@/lib/meetings/apps";

export type BuddyPhase = "asking" | "listening" | "paused" | "saving" | "done" | "error";

export type BuddyAction =
  /** asking: yes, take notes */
  | "take"
  /** asking: not this time */
  | "dismiss"
  /** asking: stop asking for this app */
  | "never"
  | "pause"
  | "resume"
  | "stop"
  /** Stop and delete everything captured so far (someone on the call objected). */
  | "discard"
  /** open the meeting (or the app) in the browser */
  | "open"
  /** tuck the bot away (done/error) */
  | "hide"
  /** listening/paused: hide the bot (say, to share the screen); it keeps taking notes, and the tray icon brings it back */
  | "tuck";

export type BuddyState = {
  phase: BuddyPhase;
  bot: { name: string; avatar: AvatarId; color: ColorwayId };
  app?: { id: MeetingAppId; name: string };
  /** Recording time before the current stretch (pauses don't count). */
  elapsedMs?: number;
  /** Epoch ms when the current listening stretch began; absent while paused. */
  runningSince?: number | null;
  /** 0..1 loudness, a few times a second while listening. */
  level?: number;
  /** The newest transcript line, shown briefly above the bot. */
  caption?: { speaker: string; text: string; at: number } | null;
  /** done / error text. */
  message?: string;
  /** Meeting minutes the account can record now (0 when the notes need credit and there's none left). */
  minutesLeft?: number | null;
  /** Owner can copy a heads-up for the call chat. */
  consentNote?: string;
  /** A standing note while listening, e.g. "I can only hear your mic here…" (not a transcript line). */
  notice?: string | null;
  /** The desktop app can hide the bot while it keeps taking notes (older versions can't: no Hide button). */
  canHide?: boolean;
};

export interface BabDesktopApi {
  /** Subscribe to state; called immediately with the current state. Returns an unsubscribe function. */
  onState(cb: (state: BuddyState) => void): () => void;
  act(action: BuddyAction): void;
  /** true while the pointer is over the bot or its bubble, so the rest of the window lets clicks through. */
  setInteractive(on: boolean): void;
  /** Copy text to the clipboard (the page may not have permission on its own). */
  copy(text: string): void;
}

declare global {
  interface Window {
    babDesktop?: BabDesktopApi;
  }
}
