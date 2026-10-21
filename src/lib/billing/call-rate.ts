/**
 * What a minute of a call with a bot costs, as it's charged (api/webhooks/twilio/voice/status): the
 * voice server's rate when calls are handed to it (NVIDIA's speech models on our own machine, so
 * just the line and its audio stream), Twilio's own speech otherwise. Server-only (reads env).
 */
import { available, config, demoMode } from "@/lib/env";
import { UNIT_PRICES } from "./prices";

/** Calls are answered by the voice server (when it can't take one, Twilio's own speech does). */
export function callsOnVoiceServer(): boolean {
  return available("voiceServer") && (config.twilio.mediaStreams || demoMode);
}

/** The price of a minute of a call someone makes to their bot, in micro-dollars. */
export function callMinuteMicros(): number {
  return callsOnVoiceServer() ? UNIT_PRICES.callMinuteStreamIn : UNIT_PRICES.callMinute;
}
