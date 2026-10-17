/**
 * Preload for the local pairing window (sandboxed). The page can ask to pair, pick a
 * bot, open a few Build-a-bot pages and unpair. It never receives the device token.
 */
const { contextBridge, ipcRenderer } = require("electron");

const OPEN = new Set(["pair-page", "bot-apps", "app", "voice", "get-claude", "get-codex"]);

contextBridge.exposeInMainWorld(
  "babPairing",
  Object.freeze({
    getState: () => ipcRenderer.invoke("pairing:get-state"),
    pair: (server, code) => ipcRenderer.invoke("pairing:pair", { server: String(server ?? ""), code: String(code ?? "") }),
    chooseBot: (botId) => ipcRenderer.invoke("pairing:choose-bot", String(botId ?? "")),
    refresh: () => ipcRenderer.invoke("pairing:refresh"),
    unpair: () => ipcRenderer.invoke("pairing:unpair"),
    /** "Give my bot a folder": pick the folder (for this bot), or stop syncing it. */
    chooseFolder: (botId) => ipcRenderer.invoke("pairing:library-choose", botId ? String(botId) : null),
    stopFolder: () => ipcRenderer.invoke("pairing:library-stop"),
    /** "Think with my Claude or ChatGPT plan here" on or off. */
    setBridge: (on) => ipcRenderer.invoke("pairing:bridge", on === true),
    open: (what, botId) => (OPEN.has(what) ? ipcRenderer.invoke("pairing:open", { what, botId: botId ? String(botId) : null }) : Promise.resolve(false)),
    close: () => ipcRenderer.send("pairing:close"),
    onState(cb) {
      if (typeof cb !== "function") return () => {};
      const fn = (_e, state) => cb(state);
      ipcRenderer.on("pairing:state", fn);
      return () => ipcRenderer.removeListener("pairing:state", fn);
    },
  }),
);
