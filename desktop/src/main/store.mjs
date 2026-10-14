/**
 * What the app remembers between runs:
 *  - settings.json: server, chosen bot, captions on/off, apps it shouldn't ask in, …
 *  - device.json:   this computer's device token, encrypted with the OS keychain
 *                   (Electron safeStorage). Never stored in plain text, unless
 *                   BAB_ALLOW_PLAINTEXT_TOKEN=1 (CI machines without a keychain).
 * No Electron import: safeStorage is passed in, so this can be tested.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SERVER = "https://build-a-bot.site";

export const DEFAULT_SETTINGS = Object.freeze({
  server: DEFAULT_SERVER,
  /** Which bot takes notes. */
  botId: /** @type {string | null} */ (null),
  /** Show the newest transcript line above the bot. */
  captions: true,
  /** Apps the owner said "Don't ask in". */
  neverApps: /** @type {string[]} */ ([]),
  /** "Pause call detection for 1 hour". */
  detectionPausedUntil: 0,
  /** macOS: name Meet/Teams calls from browser tabs (AppleScript; macOS asks first). */
  macTabs: false,
  /** Meetings whose notes we're still waiting for, or whose finish didn't reach the server. */
  pending: /** @type {Array<{ botId: string, meetingId: string, finished: boolean, at: number }>} */ ([]),
});

/** Read JSON, or null. */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write JSON atomically, readable only by this user. */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Server URLs we accept: http(s) only, no credentials, no path. */
export function normalizeServer(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  // Plain http only for this computer (local development).
  if (u.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return null;
  return u.origin;
}

export class Settings {
  /** @param {string} file */
  constructor(file) {
    this.file = file;
    const saved = readJson(file) ?? {};
    /** @type {typeof DEFAULT_SETTINGS} */
    this.data = { ...DEFAULT_SETTINGS, ...pick(saved, Object.keys(DEFAULT_SETTINGS)) };
    if (!Array.isArray(this.data.neverApps)) this.data.neverApps = [];
    if (!Array.isArray(this.data.pending)) this.data.pending = [];
  }

  get() {
    return this.data;
  }

  /** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
  update(patch) {
    this.data = { ...this.data, ...patch };
    try {
      writeJson(this.file, this.data);
    } catch {
      /* read-only disk: keep going with what's in memory */
    }
    return this.data;
  }
}

/**
 * @typedef {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string, getSelectedStorageBackend?: () => string }} SafeStorageLike
 * @typedef {{ server: string, deviceId: string, token: string, deviceName?: string }} Device
 */

export class TokenStore {
  /**
   * @param {{ file: string, safeStorage: SafeStorageLike, platform?: string, allowPlaintext?: boolean }} o
   */
  constructor(o) {
    this.file = o.file;
    this.safeStorage = o.safeStorage;
    this.platform = o.platform ?? process.platform;
    this.allowPlaintext = Boolean(o.allowPlaintext);
    /** @type {(Device & { stored: string }) | null} kept only in memory when the OS has no keychain */
    this.memory = null;
  }

  /** Can the OS keep the token safe? On Linux, "basic_text" means no keyring: not safe. */
  security() {
    let backend = "os";
    try {
      if (this.platform === "linux") backend = this.safeStorage.getSelectedStorageBackend?.() ?? "unknown";
    } catch {
      backend = "unknown";
    }
    let available = false;
    try {
      available = this.safeStorage.isEncryptionAvailable();
    } catch {
      available = false;
    }
    const secure = available && !(this.platform === "linux" && (backend === "basic_text" || backend === "unknown"));
    return { secure, backend };
  }

  /**
   * @param {Device} device
   * @returns {{ stored: 'encrypted'|'plaintext'|'memory' }}
   */
  save(device) {
    const { secure } = this.security();
    const base = { v: 1, server: device.server, deviceId: device.deviceId, deviceName: device.deviceName ?? null };
    if (secure) {
      const data = this.safeStorage.encryptString(device.token).toString("base64");
      writeJson(this.file, { ...base, token: { enc: "safeStorage", data } });
      this.memory = null;
      return { stored: "encrypted" };
    }
    if (this.allowPlaintext) {
      writeJson(this.file, { ...base, token: { enc: "plaintext", data: device.token } });
      this.memory = null;
      return { stored: "plaintext" };
    }
    // No safe place on disk: keep it for this run only (pair again next time).
    this.clearFile();
    this.memory = { ...device, stored: "memory" };
    return { stored: "memory" };
  }

  /** @returns {(Device & { stored: 'encrypted'|'plaintext'|'memory' }) | null} */
  load() {
    if (this.memory) return /** @type {any} */ (this.memory);
    const saved = readJson(this.file);
    if (!saved || typeof saved.server !== "string" || typeof saved.deviceId !== "string" || !saved.token) return null;
    let token = null;
    let stored = /** @type {'encrypted'|'plaintext'} */ ("encrypted");
    if (saved.token.enc === "safeStorage") {
      try {
        token = this.safeStorage.decryptString(Buffer.from(saved.token.data, "base64"));
      } catch {
        return null; // keychain changed or unavailable: pair again
      }
    } else if (saved.token.enc === "plaintext") {
      if (!this.allowPlaintext) return null;
      token = saved.token.data;
      stored = "plaintext";
    }
    if (typeof token !== "string" || !token.startsWith("bab_dev_")) return null;
    return { server: saved.server, deviceId: saved.deviceId, deviceName: saved.deviceName ?? undefined, token, stored };
  }

  clear() {
    this.memory = null;
    this.clearFile();
  }

  clearFile() {
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      /* already gone */
    }
  }
}

function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
