/**
 * Build-a-bot desktop: the main process.
 *
 * A tray / menu-bar app. It notices when a call starts (detect/), pops the owner's bot
 * up at the bottom of the screen to ask "Want me to take notes?" (buddy-window.mjs),
 * and only after a yes captures the mic and the call's audio (capture-window.mjs),
 * uploads it in chunks (upload-queue.mjs) and tells the owner when the notes are ready.
 *
 * Voice typing (voice/): hold a shortcut anywhere and talk; what you meant is typed where your
 * cursor is. Off until the owner sets it up.
 *
 * Dev/test switches (never needed by owners):
 *   --server=<url> or BAB_SERVER        point at a local server (e.g. http://localhost:3000)
 *   BAB_USER_DATA=<dir>                 use another settings folder
 *   BAB_FAKE_MEETING=<app>              pretend a call is going on in <app>
 *   BAB_FAKE_MEETING_FILE=<path>        …whenever this file names an app (re-read every check)
 *   BAB_FAKE_MEDIA=1                    Chromium's fake mic (with --use-fake-ui-for-media-stream)
 *   BAB_ALLOW_PLAINTEXT_TOKEN=1         CI without a keychain: store the device token unencrypted
 *   BAB_DETECT_INTERVAL_MS, BAB_DETECT_SUSTAIN_MS, BAB_CALL_END_GRACE_MS, BAB_ASK_TIMEOUT_MS, BAB_NOT_NOW_COOLDOWN_MS,
 *   BAB_SILENCE_STOP_MS, BAB_SLOW_NOTES_MS   shorter timings for tests
 *   BAB_SYSTEM_AUDIO=off                mic only
 *   BAB_TEST_DENY_SYSTEM_AUDIO=1        act as if the OS refused system audio (tests the mic-only path)
 *   BAB_TEST=1                          expose a read-only state probe to the e2e test (no token)
 *   BAB_VOICE_ENABLE=1                  turn voice typing on at start (tests)
 *   BAB_VOICE_DEMO=<n>|command          which sample line a demo server "hears" (tests)
 *   BAB_VOICE_DEMO_FILE=<path>          …re-read from this file on every dictation
 *   BAB_SMOKE=1                         check itself and quit: exit code 0 if all is well (CI, after
 *                                       installing the packaged app); results in BAB_SMOKE_OUT (JSON)
 */
import * as electron from "electron";
import { Notification, app, clipboard, ipcMain, powerMonitor, protocol, safeStorage, screen, session, shell, systemPreferences } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, deviceName } from "./account.mjs";
import { createApi } from "./api.mjs";
import { BuddyWindow } from "./buddy-window.mjs";
import { CaptureWindow } from "./capture-window.mjs";
import { Controller } from "./controller.mjs";
import { Detector } from "./detect/index.mjs";
import { createTracker } from "./detect/tracker.mjs";
import { SCHEME } from "./local-pages.mjs";
import { createLogger } from "./log.mjs";
import { PairingWindow } from "./pairing-window.mjs";
import { Spool } from "./spool.mjs";
import { DEFAULT_SERVER, Settings, TokenStore, normalizeServer } from "./store.mjs";
import { AppTray } from "./tray.mjs";
import { UploadQueue } from "./upload-queue.mjs";
import { setupVoice } from "./voice/index.mjs";

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NOTIFY_ICON = path.join(APP_ROOT, "assets", "icon.png");
const env = process.env;
const num = (v, d) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const argValue = (name) => {
  const pre = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : null;
};

if (env.BAB_USER_DATA) app.setPath("userData", path.resolve(env.BAB_USER_DATA));
if (app.isPackaged) env.BAB_PACKAGED = "1";
const serverOverride = argValue("server") ?? env.BAB_SERVER ?? null;

// System-audio loopback on Linux sits behind a Chromium feature that's off by default.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "PulseaudioLoopbackForScreenShare");
if (env.BAB_FAKE_MEDIA === "1") {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** @type {ReturnType<typeof createLogger>} */
let log = (m) => console.log(m);
let settings, tokens, api, account, spool, uploads, buddy, capture, controller, pairing, detector, tray, voice;
const notifications = new Set();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => void pairing?.show());
  app.on("window-all-closed", () => {
    /* keep running in the tray */
  });
  app.whenReady().then(boot, (err) => {
    console.error(err);
    app.exit(1);
  });
}

async function boot() {
  const userData = app.getPath("userData");
  log = createLogger({ file: path.join(userData, "logs", "main.log"), echo: !app.isPackaged || env.BAB_LOG === "1" });
  log(`Build-a-bot desktop ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}-${process.arch}`);
  if (process.platform === "darwin") app.dock?.hide();
  if (process.platform === "win32") app.setAppUserModelId("site.build-a-bot.desktop");

  settings = new Settings(path.join(userData, "settings.json"));
  if (serverOverride) {
    const s = normalizeServer(serverOverride);
    if (s) settings.update({ server: s });
  }
  tokens = new TokenStore({ file: path.join(userData, "device.json"), safeStorage, allowPlaintext: env.BAB_ALLOW_PLAINTEXT_TOKEN === "1" });
  const sec = tokens.security();
  log(`token storage: ${sec.secure ? "system keychain" : tokens.allowPlaintext ? "PLAIN TEXT (BAB_ALLOW_PLAINTEXT_TOKEN=1, testing only)" : "memory only (no keychain)"} [${sec.backend}]`);

  // API calls use their own cookie-less session.
  const apiSession = session.fromPartition("bab-api");
  apiSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  api = createApi({ fetch: (url, init) => apiSession.fetch(url, init), server: () => account?.server() ?? null, token: () => account?.token() ?? null });
  account = new Account({ api, tokens, settings, log });
  spool = new Spool(path.join(userData, "spool"));
  uploads = new UploadQueue({
    send: (item) => api.uploadChunk(item),
    spool,
    log,
    onUploaded: (item, body) => controller?.onUploaded(item, body),
    onStop: (reason, item) => controller?.onUploadStop(reason, item),
  });
  buddy = new BuddyWindow({ server: () => account.server(), openExternal: (url) => openMeetingLink(url), onGone: () => controller?.onBuddyGone(), log });
  capture = new CaptureWindow({
    onChunk: (c) => controller?.onChunk(c),
    onLevel: (l) => controller?.onLevel(l),
    onTrackEnded: (i) => controller?.onTrackEnded(i),
    log,
  });
  controller = new Controller({
    account,
    settings,
    api,
    buddy,
    capture,
    uploads,
    spool,
    notify,
    openUrl: openAppLink,
    openSpecial,
    writeClipboard: (t) => clipboard.writeText(t),
    systemAudioMode: () => (env.BAB_SYSTEM_AUDIO === "off" ? "off" : "loopback"),
    ensureMicAccess,
    limits: {
      askTimeoutMs: num(env.BAB_ASK_TIMEOUT_MS, undefined),
      notNowCooldownMs: num(env.BAB_NOT_NOW_COOLDOWN_MS, undefined),
      silenceStopMs: num(env.BAB_SILENCE_STOP_MS, undefined),
      slowNotesMs: num(env.BAB_SLOW_NOTES_MS, undefined),
    },
    log,
  });
  pairing = new PairingWindow({ log });
  voice = setupVoice({
    electron,
    settings,
    tokens,
    account,
    api,
    apiSession,
    buddy,
    userData,
    openAppLink,
    showPairing: () => void pairing.show(),
    ensureMicAccess,
    onChange: () => {
      tray?.update();
      voice?.pushState();
    },
    log,
  });
  if (env.BAB_VOICE_ENABLE === "1") settings.updateVoice({ enabled: true, introduced: true });

  const sustain = num(env.BAB_DETECT_SUSTAIN_MS, null);
  detector = new Detector({
    intervalMs: num(env.BAB_DETECT_INTERVAL_MS, 3000),
    ownPids: () => new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]),
    ownExe: process.execPath,
    ownBinaries: [path.basename(process.execPath).toLowerCase(), "electron", "build-a-bot"],
    macHelper: findMacHelper(),
    macTabs: () => Boolean(settings.get().macTabs),
    fakeApp: env.BAB_FAKE_MEETING || null,
    fakeFile: env.BAB_FAKE_MEETING_FILE || null,
    tracker: createTracker({
      ...(sustain != null ? { sustainMs: { native: sustain, browser: sustain } } : {}),
      endGraceMs: num(env.BAB_CALL_END_GRACE_MS, 15_000),
    }),
    log,
  });
  detector.on("call-start", (ev) => void controller.onCallStart(ev));
  detector.on("call-end", (ev) => controller.onCallEnd(ev));
  detector.on("call-update", (ev) => controller.onCallUpdate(ev));
  detector.on("status", (s) => {
    log(`detect: ${s.mode}${s.detail ? ` (${s.detail})` : ""}`);
    tray?.update();
  });

  tray = new AppTray({ model: trayModel, onClick: onTrayClick });
  account.on("change", () => {
    tray.update();
    pairing.send(pairingState());
    voice.pushState();
  });
  account.on("signed-out", (reason) => {
    // Unsent audio from the old pairing goes too (from memory as well as the spool):
    // it must not be retried later with another pairing's token.
    uploads.dropAll();
    spool.clear();
    // Voice typing stops, and this computer's voice history goes with the pairing.
    voice.forget();
    // Unpaired from the web app: say so where the owner can pair again.
    if (reason) {
      notify({ title: "Build-a-bot was unpaired", body: reason, onClick: () => void pairing.show() });
      void pairing.show();
    }
  });
  controller.on("change", () => tray.update());
  setInterval(() => tray.update(), 30_000);

  registerIpc();
  powerMonitor.on("lock-screen", () => {
    controller.onPower("lock-screen");
    void voice.interrupt();
  });
  powerMonitor.on("suspend", () => {
    controller.onPower("suspend");
    void voice.interrupt();
  });
  for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) screen.on(/** @type {any} */ (ev), () => buddy.reassert());

  let readyToQuit = false;
  let shuttingDown = false;
  app.on("before-quit", (e) => {
    if (readyToQuit) return;
    e.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    detector.stop();
    void voice.interrupt();
    voice.dispose();
    controller
      .shutdown()
      .catch((err) => log(`shutdown: ${err}`))
      .finally(() => {
        readyToQuit = true;
        buddy.destroy();
        capture.destroy();
        tray.destroy();
        app.quit();
      });
  });

  if (env.BAB_TEST === "1") exposeTestProbe();

  account.load();
  if (!account.device) await pairing.show();
  else account.once("change", () => void controller.resumeLeftovers(spool));
  detector.start();
  await voice.apply();
  if (env.BAB_SMOKE === "1") await smoke();
}

/** BAB_SMOKE=1: the packaged app checks itself, says how it went, and quits. */
async function smoke() {
  /** @type {Record<string, unknown>} */
  const results = { version: app.getVersion(), platform: `${process.platform}-${process.arch}`, packaged: app.isPackaged };
  try {
    results.tray = tray ? "ok" : "FAILED: no tray icon";
    results["pairing window"] = pairing.webContents?.getURL().startsWith("bab-app://pairing") ? "ok" : "FAILED: it didn't load";
    Object.assign(results, await voice.smoke());
  } catch (err) {
    results.error = `FAILED: ${/** @type {any} */ (err)?.message ?? err}`;
  }
  const ok = !Object.values(results).some((v) => typeof v === "string" && v.startsWith("FAILED"));
  log(`smoke: ${ok ? "passed" : "FAILED"} ${JSON.stringify(results)}`);
  if (env.BAB_SMOKE_OUT) fs.writeFileSync(env.BAB_SMOKE_OUT, JSON.stringify({ ok, results }, null, 2));
  app.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------

function registerIpc() {
  const fromBuddy = (e) => {
    const wc = buddy.webContents;
    const server = account.server();
    if (!wc || e.sender !== wc || !server || !e.senderFrame || e.senderFrame !== wc.mainFrame) return false;
    try {
      return new URL(e.senderFrame.url).origin === new URL(server).origin;
    } catch {
      return false;
    }
  };
  ipcMain.on("buddy:get-state", (e) => {
    e.returnValue = fromBuddy(e) ? buddy.state : null;
  });
  ipcMain.on("buddy:act", (e, action) => fromBuddy(e) && controller.onBuddyAction(String(action)));
  ipcMain.on("buddy:interactive", (e, on) => {
    if (!fromBuddy(e)) return;
    buddy.setInteractive(on === true);
    controller.onInteractive(on === true);
  });
  ipcMain.on("buddy:copy", (e, text) => {
    if (fromBuddy(e) && typeof text === "string" && text.length <= 2000) controller.onCopy(text);
  });

  ipcMain.on("capture:chunk", (e, c) => capture.isSender(e) && controller.onChunk(c));
  ipcMain.on("capture:level", (e, l) => capture.isSender(e) && controller.onLevel(l));
  ipcMain.on("capture:track-ended", (e, i) => capture.isSender(e) && controller.onTrackEnded(i));
  ipcMain.on("capture:flushed", (e) => capture.isSender(e) && capture.flushed());
  ipcMain.on("capture:log", (e, m) => capture.isSender(e) && log(`capture page: ${String(m).slice(0, 300)}`));

  const fromPairing = (e) => {
    if (!pairing.isSender(e)) throw new Error("not allowed");
  };
  ipcMain.handle("pairing:get-state", (e) => (fromPairing(e), pairingState()));
  ipcMain.handle("pairing:pair", async (e, arg) => {
    fromPairing(e);
    const r = await account.pair(String(arg?.server ?? ""), String(arg?.code ?? ""));
    if (!r.ok) return r;
    void controller.resumeLeftovers(spool);
    void voice.apply();
    return { ok: true, state: pairingState() };
  });
  ipcMain.handle("pairing:choose-bot", (e, id) => {
    fromPairing(e);
    account.chooseBot(String(id));
    return pairingState();
  });
  ipcMain.handle("pairing:refresh", async (e) => {
    fromPairing(e);
    await account.refresh();
    return pairingState();
  });
  ipcMain.handle("pairing:unpair", async (e) => {
    fromPairing(e);
    if (controller.isRecording()) {
      controller.stopNow();
      const t0 = Date.now();
      while (controller.isRecording() && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 100));
    }
    await account.unpair();
    return pairingState();
  });
  ipcMain.handle("pairing:open", (e, arg) => {
    fromPairing(e);
    const what = arg?.what;
    if (what === "pair-page") openAppLink(`${normalizeServer(account.server() ?? settings.get().server) ?? DEFAULT_SERVER}/app/bridge#desktop`, { anyServer: true });
    else if (what === "bot-apps") openAppLink(controller.urlFor("apps", { botId: arg?.botId ?? null }));
    else if (what === "voice") void voice.showSettings("setup");
    else openAppLink(controller.urlFor("app"));
    return true;
  });
  ipcMain.on("pairing:close", (e) => pairing.isSender(e) && pairing.close());

  voice.registerIpc(ipcMain);
}

function pairingState() {
  return {
    paired: Boolean(account.device),
    status: account.status,
    server: account.server() ?? settings.get().server,
    defaultServer: DEFAULT_SERVER,
    deviceName: account.device?.deviceName ?? deviceName(),
    ownerName: account.session?.owner?.name ?? null,
    storage: account.device?.stored ?? null,
    signedOutReason: account.signedOutReason,
    bots: account.bots().map((b) => ({ id: b.id, name: b.name, color: b.color, meetingsOn: b.meetingsOn, paused: b.paused })),
    botId: account.bot()?.id ?? null,
    trayWord: process.platform === "darwin" ? "menu bar" : "tray",
    voice: voice.trayInfo(),
  };
}

function trayModel() {
  const s = settings.get();
  let status = controller.statusText();
  if (controller.state.phase === "idle" && account.canTakeNotes() && !(s.detectionPausedUntil > Date.now())) {
    if (detector.status.mode === "unavailable") status = `Can't notice calls: ${detector.status.detail}`;
    else if (detector.status.mode === "limited") status = "Watching for calls (limited on this computer)";
  }
  return {
    status,
    icon: "watching",
    signedIn: Boolean(account.device),
    phase: controller.state.phase,
    canTake: account.canTakeNotes(),
    detectionPaused: s.detectionPausedUntil > Date.now(),
    captions: s.captions,
    openAtLogin: getOpenAtLogin(),
    macTabs: s.macTabs,
    platform: process.platform,
    bots: account.bots(),
    botId: account.bot()?.id ?? null,
    neverApps: s.neverApps,
    voice: voice ? voice.trayInfo() : null,
  };
}

function onTrayClick(id, checked) {
  if (id === "take") controller.takeNow();
  else if (id === "stop") controller.stopNow();
  else if (id === "pause") controller.dispatch({ type: "pause" });
  else if (id === "resume") controller.dispatch({ type: "resume" });
  else if (id === "copy-heads-up") controller.copyHeadsUp();
  else if (id === "detect-pause") settings.update({ detectionPausedUntil: Date.now() + 3600_000 });
  else if (id === "detect-resume") settings.update({ detectionPausedUntil: 0 });
  else if (id === "captions") {
    settings.update({ captions: Boolean(checked) });
    if (!checked) controller.caption = null;
    controller.render();
  } else if (id.startsWith("bot:")) account.chooseBot(id.slice(4));
  else if (id.startsWith("turn-on:")) openAppLink(controller.urlFor("apps", { botId: id.slice(8) }));
  else if (id.startsWith("ask-again:")) settings.update({ neverApps: settings.get().neverApps.filter((a) => a !== id.slice(10)) });
  else if (id === "mac-tabs") settings.update({ macTabs: Boolean(checked) });
  else if (id === "voice-setup" || id === "voice-settings") void voice.showSettings(id === "voice-setup" ? "setup" : undefined);
  else if (id === "voice-paste-last") void voice.voice.pasteLast();
  else if (id === "open-app") openAppLink(controller.urlFor("app"));
  else if (id === "pair" || id === "account") void pairing.show();
  else if (id === "login") setOpenAtLogin(Boolean(checked));
  else if (id === "quit") app.quit();
  tray.update();
}

/** Open a Build-a-bot page in the browser — only the paired server's (or its public URL's) own pages. */
function openAppLink(url, opts = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return;
  const allowed = new Set();
  for (const s of [account.server(), account.appUrl(), opts.anyServer ? url : null]) {
    try {
      if (s) allowed.add(new URL(s).origin);
    } catch {
      /* skip */
    }
  }
  if (!allowed.has(u.origin)) {
    log(`blocked a link to another site: ${u.origin}`);
    return;
  }
  void shell.openExternal(u.toString());
}

/** Links the buddy page tries to open: only the server's own meeting pages. */
function openMeetingLink(url) {
  try {
    if (/^\/app\/bots\/[^/]+\/meetings(\/[^/]+)?\/?$/.test(new URL(url).pathname)) return openAppLink(url);
  } catch {
    /* not a URL */
  }
  log("blocked a link from the buddy page");
}

function openSpecial(target) {
  if (target === "pair") return void pairing.show();
  if (target === "permissions") {
    if (process.platform === "darwin") void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
    else if (process.platform === "win32") void shell.openExternal("ms-settings:privacy-microphone");
    else openAppLink(controller.urlFor("app"));
  }
}

/** macOS asks for the microphone the first time; elsewhere the OS settings decide. */
async function ensureMicAccess() {
  if (process.platform !== "darwin") return true;
  try {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return true;
    if (status === "not-determined") return await systemPreferences.askForMediaAccess("microphone");
    return false;
  } catch {
    return true;
  }
}

function notify({ title, body, onClick }) {
  log(`notify: ${title}`);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: process.platform === "linux" ? NOTIFY_ICON : undefined });
  notifications.add(n);
  n.on("click", () => onClick?.());
  n.on("close", () => notifications.delete(n));
  n.show();
  setTimeout(() => notifications.delete(n), 15 * 60_000);
}

function findMacHelper() {
  if (process.platform !== "darwin") return null;
  const candidates = [env.BAB_MAC_HELPER, path.join(process.resourcesPath ?? "", "bin", "bab-audio-helper"), path.join(APP_ROOT, "native", "macos", "build", "bab-audio-helper")];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

const autostartFile = () => path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "build-a-bot.desktop");

function getOpenAtLogin() {
  try {
    if (process.platform === "linux") return fs.existsSync(autostartFile());
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function setOpenAtLogin(on) {
  try {
    if (process.platform === "linux") {
      const file = autostartFile();
      if (!on) return fs.rmSync(file, { force: true });
      const exec = env.APPIMAGE ? `"${env.APPIMAGE}"` : app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Build-a-bot\nComment=Your bot notices calls and asks before it takes notes\nExec=${exec}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
      return;
    }
    app.setLoginItemSettings({ openAtLogin: on });
  } catch (err) {
    log(`login item: ${err}`);
  }
}

/** For the e2e test only (BAB_TEST=1): a read-only look at the state. Never includes the token. */
function exposeTestProbe() {
  globalThis.__babTest = {
    state() {
      const b = buddy.win && !buddy.win.isDestroyed() ? buddy.win.getBounds() : null;
      return {
        phase: controller.state.phase,
        call: controller.state.call,
        calls: Object.keys(controller.state.calls),
        meetingId: controller.rec?.meetingId ?? controller.state.meetingId ?? controller.state.lastMeetingId ?? null,
        botId: account.bot()?.id ?? null,
        system: controller.rec?.system ?? null,
        account: account.status,
        paired: Boolean(account.device),
        stored: account.device?.stored ?? null,
        detect: detector.status,
        buddyShowing: buddy.isShowing(),
        buddyBounds: b,
        buddyUrl: buddy.webContents?.getURL() ?? null,
        workArea: screen.getPrimaryDisplay().workArea,
        caption: controller.caption,
        stats: controller.stats,
        uploads: uploads.stats,
        spoolFiles: spool.list().length,
        tray: trayModel().status,
        voice: voice.probe(),
      };
    },
  };
}
