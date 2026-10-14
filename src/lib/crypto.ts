/**
 * Secrets at rest and signed tokens.
 *
 * - Secrets (API keys, OAuth tokens, bot tokens) are encrypted with AES-256-GCM
 *   under ENCRYPTION_KEY (32 bytes, base64). Envelope: "v1.<iv>.<tag>.<ciphertext>".
 * - Session and login tokens are random; only their sha256 is stored.
 * - Short signed tokens (approval buttons, webhook paths) use HMAC-SHA256 under a
 *   key derived from ENCRYPTION_KEY.
 *
 * In development without ENCRYPTION_KEY a key is generated once and kept in
 * .data/dev-encryption-key so local data stays readable across restarts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
    cachedKey = key;
    return key;
  }
  if (process.env.NODE_ENV === "production" && !process.env.DEMO_MODE && !process.env.VERCEL_ENV?.startsWith("preview")) {
    throw new Error("ENCRYPTION_KEY is required in production");
  }
  const dir = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), ".data");
  const file = path.join(dir, "dev-encryption-key");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    cachedKey = Buffer.from(existing, "base64");
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString("base64"), { mode: 0o600 });
    cachedKey = key;
  }
  return cachedKey!;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string): string {
  const [version, ivB64, tagB64, ctB64] = envelope.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Unrecognized secret envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

/** "…a1b2" — the only part of a secret we ever show again. */
export function secretHint(secret: string): string {
  const s = secret.trim();
  return s.length <= 4 ? "…" : `…${s.slice(-4)}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hmacKey(): Buffer {
  return crypto.createHmac("sha256", loadKey()).update("build-a-bot/hmac/v1").digest();
}

export function hmac(data: string): string {
  return crypto.createHmac("sha256", hmacKey()).update(data).digest("base64url");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Compact signed token: base64url(json).sig — for approval buttons and similar one-shot links. */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  return `${body}.${hmac(body)}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!timingSafeEqualStr(hmac(body), sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Human-friendly one-time code: 6 digits. */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}

/** Pairing code like "K7XQ-29MD" (no 0/O/1/I). */
export function pairingCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const pick = () => alphabet[crypto.randomInt(0, alphabet.length)];
  const part = () => Array.from({ length: 4 }, pick).join("");
  return `${part()}-${part()}`;
}

/** PKCE helpers (RFC 7636). */
export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" as const };
}
