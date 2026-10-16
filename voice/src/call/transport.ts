/**
 * Where a call's audio comes from and goes to: a phone call (Twilio Media Streams, 8 kHz μ-law) or
 * the browser (16 kHz PCM up, Magpie's own rate down). The session only sees this interface.
 */

export interface CallTransport {
  readonly kind: "web" | "phone";
  /** The rate audio is played at, so speech is synthesized at it directly. */
  readonly outputRate: number;
  /** Does the far end report marks as its playback reaches them? */
  readonly reportsMarks: boolean;

  /** Caller audio, 16 kHz mono. */
  onAudio: ((pcm: Int16Array) => void) | null;
  /** A key pressed on a phone keypad. */
  onDtmf: ((digit: string) => void) | null;
  /** Playback reached a mark sent with mark(). */
  onMark: ((name: string) => void) | null;
  /** The far end hung up or the connection dropped. */
  onClose: ((why: string) => void) | null;

  /** Audio to play, at outputRate. It may arrive faster than real time: the far end buffers it. */
  sendAudio(pcm: Int16Array): void;
  /** Ask to hear back (onMark) when playback gets here. */
  mark(name: string): void;
  /** Drop audio sent but not yet played: the caller cut in. */
  clear(): void;
  /** Live call state for a screen (transcript, who's talking, latency). Phone calls ignore it. */
  event(event: Record<string, unknown>): void;
  close(reason?: string): void;
}
