/**
 * G.711 μ-law, the 8 kHz telephone codec Twilio Media Streams carry. Both directions are table
 * lookups: 256 entries to decode, 64K to encode.
 */

const BIAS = 0x84;
const CLIP = 32635;

function encodeSample(sample: number): number {
  let s = sample;
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function decodeByte(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -magnitude : magnitude;
}

const DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) DECODE[i] = decodeByte(i);

const ENCODE = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) ENCODE[i] = encodeSample(i - 32768);

export function mulawToPcm(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i]];
  return out;
}

export function pcmToMulaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = ENCODE[pcm[i] + 32768];
  return out;
}

/** μ-law byte for digital silence. */
export const MULAW_SILENCE = ENCODE[32768];
