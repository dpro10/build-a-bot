/**
 * Preload for voice typing's pill (bab-app://dictation), sandboxed. The page gets its state and
 * can report its size, a button press and the pointer being over it. Recording is started and
 * stopped by the main process; the page never gets the device token or anything else.
 */
const { contextBridge, ipcRenderer } = require("electron");

const ACTIONS = new Set(["done", "cancel", "dismiss", "retry", "paste", "copy", "reply", "chat", "type-instead", "upgrade", "pair", "settings", "mic-settings", "accessibility"]);

contextBridge.exposeInMainWorld(
  "babDictation",
  Object.freeze({
    onState(cb) {
      if (typeof cb !== "function") return () => {};
      const fn = (_e, state) => cb(state);
      ipcRenderer.on("dictation:state", fn);
      return () => ipcRenderer.removeListener("dictation:state", fn);
    },
    size(width, height) {
      if (Number.isFinite(width) && Number.isFinite(height)) ipcRenderer.send("dictation:size", { width, height });
    },
    action(name) {
      if (typeof name === "string" && ACTIONS.has(name)) ipcRenderer.send("dictation:action", name);
    },
    hover(on) {
      ipcRenderer.send("dictation:hover", on === true);
    },
    log(msg) {
      ipcRenderer.send("dictation:log", String(msg).slice(0, 300));
    },
  }),
);
