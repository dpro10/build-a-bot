/*
 * The hidden decoder page: a piece of a meeting (webm/opus) → 16 kHz mono 16-bit WAV, the format
 * NVIDIA Parakeet reads, with the browser's own audio decoder. It has no network, no microphone and
 * no preload; the main process calls window.__babDecode.toWav16k(base64, mime) and gets base64 back.
 */
"use strict";

(() => {
  const RATE = 16000;

  const fromBase64 = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const toBase64 = (bytes) => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  /**
   * Decoded at 16 kHz (the context resamples), the channels averaged to one, and a second of
   * silence after it: without it, a word that runs to the very end of a piece comes out cut.
   */
  async function toWav16k(b64) {
    const bytes = fromBase64(String(b64 || ""));
    if (!bytes.length) throw new Error("empty");
    const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.buffer);
    const n = decoded.length;
    const channels = decoded.numberOfChannels;
    const pcm = new Float32Array(n);
    for (let c = 0; c < channels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < n; i++) pcm[i] += data[i] / channels;
    }
    const frames = n + RATE;
    const out = new DataView(new ArrayBuffer(44 + frames * 2));
    const text = (at, s) => {
      for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i));
    };
    text(0, "RIFF");
    out.setUint32(4, 36 + frames * 2, true);
    text(8, "WAVEfmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 1, true);
    out.setUint32(24, RATE, true);
    out.setUint32(28, RATE * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    text(36, "data");
    out.setUint32(40, frames * 2, true);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]));
      out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return toBase64(new Uint8Array(out.buffer));
  }

  window.__babDecode = Object.freeze({ toWav16k });
})();
