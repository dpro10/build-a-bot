import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUDDY_SIZES, buddyBounds, isOnScreen, pickDisplay, pointInRects, sizeFor } from "../src/main/placement.mjs";
import { Settings, TokenStore, normalizeServer } from "../src/main/store.mjs";
import { consentNote } from "../src/main/apps.mjs";

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 800 } };
const right = { id: 2, bounds: { x: 1440, y: -200, width: 2560, height: 1440 }, workArea: { x: 1440, y: -200, width: 2560, height: 1400 } };

test("placement: bottom-center of the work area, sized per phase", () => {
  assert.deepEqual(buddyBounds(primary.workArea, BUDDY_SIZES.asking), { x: 500, y: 495, width: 440, height: 330 });
  assert.deepEqual(buddyBounds(primary.workArea, sizeFor("listening")), { x: 300, y: 625, width: 840, height: 200 });
  assert.deepEqual(buddyBounds(right.workArea, sizeFor("done")), { x: 1440 + 1070, y: 970, width: 420, height: 230 });
  // Slid along the bottom, it snaps back inside the work area.
  assert.equal(buddyBounds(primary.workArea, sizeFor("listening"), { offsetX: 5000 }).x, 1440 - 840);
  assert.equal(buddyBounds(primary.workArea, sizeFor("listening"), { offsetX: -5000 }).x, 0);
  // A tiny screen: never bigger than the work area.
  assert.deepEqual(buddyBounds({ x: 0, y: 0, width: 300, height: 150 }, sizeFor("asking")), { x: 0, y: 0, width: 300, height: 150 });
  assert.equal(sizeFor("bogus"), BUDDY_SIZES.listening);
});

test("placement: the display the call is on, else the primary; on-screen checks", () => {
  assert.equal(pickDisplay([primary, right], primary, null), primary);
  assert.equal(pickDisplay([primary, right], primary, { x: 1600, y: 100, width: 1200, height: 800 }), right);
  assert.equal(pickDisplay([primary, right], primary, { x: 1300, y: 100, width: 200, height: 300 }), primary, "mostly on the primary");
  assert.equal(isOnScreen(buddyBounds(primary.workArea, sizeFor("listening")), [primary, right]), true);
  assert.equal(isOnScreen({ x: 5000, y: 5000, width: 420, height: 200 }, [primary, right]), false);
  assert.equal(pointInRects({ x: 10, y: 10 }, [{ x: 0, y: 0, width: 20, height: 20 }]), true);
  assert.equal(pointInRects({ x: 30, y: 10 }, [{ x: 0, y: 0, width: 20, height: 20 }]), false);
});

const fakeSafe = (opts = {}) => ({
  isEncryptionAvailable: () => opts.available ?? true,
  getSelectedStorageBackend: () => opts.backend ?? "gnome_libsecret",
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString("base64")}`),
  decryptString: (b) => Buffer.from(String(b).slice(4), "base64").toString(),
});

const device = { server: "https://build-a-bot.site", deviceId: "dev_1", token: "bab_dev_secret_123", deviceName: "Dana's Mac" };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bab-store-")), "device.json");

test("token store: encrypted with the OS keychain, never in plain text on disk", () => {
  const file = tmpFile();
  const store = new TokenStore({ file, safeStorage: fakeSafe(), platform: "darwin" });
  assert.deepEqual(store.save(device), { stored: "encrypted" });
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("bab_dev_secret_123"), "the token isn't readable in the file");
  // Only the owner can read it (Windows has no such mode bits: the profile folder is the owner's).
  if (process.platform !== "win32") assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
  const loaded = new TokenStore({ file, safeStorage: fakeSafe(), platform: "darwin" }).load();
  assert.equal(loaded.token, "bab_dev_secret_123");
  assert.equal(loaded.stored, "encrypted");
  store.clear();
  assert.equal(fs.existsSync(file), false);
});

test("token store: no keyring (Linux basic_text) → memory only, unless BAB_ALLOW_PLAINTEXT_TOKEN", () => {
  const file = tmpFile();
  const noKeyring = fakeSafe({ backend: "basic_text" });
  const store = new TokenStore({ file, safeStorage: noKeyring, platform: "linux" });
  assert.equal(store.security().secure, false);
  assert.deepEqual(store.save(device), { stored: "memory" });
  assert.equal(fs.existsSync(file), false, "nothing written");
  assert.equal(store.load().token, device.token, "works for this run");
  assert.equal(new TokenStore({ file, safeStorage: noKeyring, platform: "linux" }).load(), null, "pair again next time");

  const ci = new TokenStore({ file, safeStorage: noKeyring, platform: "linux", allowPlaintext: true });
  assert.deepEqual(ci.save(device), { stored: "plaintext" });
  assert.equal(new TokenStore({ file, safeStorage: noKeyring, platform: "linux", allowPlaintext: true }).load().stored, "plaintext");
  assert.equal(new TokenStore({ file, safeStorage: noKeyring, platform: "linux" }).load(), null, "a plaintext token is ignored without the flag");
});

test("settings: defaults, saved changes, and server URLs", () => {
  const file = tmpFile();
  const s = new Settings(file);
  assert.equal(s.get().server, "https://build-a-bot.site");
  assert.equal(s.get().captions, true);
  s.update({ neverApps: ["zoom"], captions: false });
  const again = new Settings(file).get();
  assert.deepEqual(again.neverApps, ["zoom"]);
  assert.equal(again.captions, false);
  assert.equal("autoStart" in again, false, "there is no auto-record setting");

  assert.equal(normalizeServer("build-a-bot.site"), "https://build-a-bot.site");
  assert.equal(normalizeServer("http://localhost:3000/app/bridge"), "http://localhost:3000");
  assert.equal(normalizeServer("http://example.com"), null, "plain http only for this computer");
  assert.equal(normalizeServer("https://user:pw@example.com"), null);
  assert.equal(normalizeServer("javascript:alert(1)"), null);
});

test("the heads-up says it's an AI and names the bot", () => {
  assert.match(consentNote("Inky"), /my AI assistant Inky to take notes on this call/);
  assert.match(consentNote(""), /my AI assistant to take notes/);
});
