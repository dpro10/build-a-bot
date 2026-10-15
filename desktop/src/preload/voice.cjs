/**
 * Preload for voice typing's window (bab-app://voice), sandboxed. The page can change voice
 * typing's settings, manage the dictionary and this computer's history, and open a few pages.
 * It never receives the device token.
 */
const { contextBridge, ipcRenderer } = require("electron");

const OPEN = new Set(["upgrade", "app", "voice-page", "pair", "mic-settings", "accessibility"]);
const str = (v, max) => String(v ?? "").slice(0, max);

contextBridge.exposeInMainWorld(
  "babVoice",
  Object.freeze({
    getState: () => ipcRenderer.invoke("voice:get-state"),
    /** Change settings: { enabled, shortcut, polish, styles, commands, sounds, language, micId, history, restoreClipboard }. */
    set: (patch) => ipcRenderer.invoke("voice:set", patch && typeof patch === "object" ? patch : {}),
    /** The next keys pressed together become the shortcut. */
    recordShortcut: () => ipcRenderer.invoke("voice:record-shortcut"),
    cancelRecordShortcut: () => ipcRenderer.send("voice:cancel-record-shortcut"),
    /** "mic" asks for the microphone; "accessibility" asks macOS to let it hear the shortcut and paste. */
    permission: (kind) => ipcRenderer.invoke("voice:permission", str(kind, 20)),
    microphones: () => ipcRenderer.invoke("voice:microphones"),
    dictionary: () => ipcRenderer.invoke("voice:dictionary"),
    addEntry: (entry) => ipcRenderer.invoke("voice:dictionary-add", entry && typeof entry === "object" ? entry : {}),
    updateEntry: (id, patch) => ipcRenderer.invoke("voice:dictionary-update", { id: str(id, 100), patch: patch && typeof patch === "object" ? patch : {} }),
    deleteEntry: (id) => ipcRenderer.invoke("voice:dictionary-delete", str(id, 100)),
    copy: (id) => ipcRenderer.invoke("voice:history-copy", str(id, 100)),
    remove: (id) => ipcRenderer.invoke("voice:history-remove", str(id, 100)),
    clearHistory: () => ipcRenderer.invoke("voice:history-clear"),
    /** Save a corrected version; returns words worth adding to the dictionary. */
    fix: (id, text) => ipcRenderer.invoke("voice:history-fix", { id: str(id, 100), text: str(text, 20000) }),
    open: (what) => (OPEN.has(what) ? ipcRenderer.invoke("voice:open", what) : Promise.resolve(false)),
    onState(cb) {
      if (typeof cb !== "function") return () => {};
      const fn = (_e, state) => cb(state);
      ipcRenderer.on("voice:state", fn);
      return () => ipcRenderer.removeListener("voice:state", fn);
    },
    onSection(cb) {
      if (typeof cb !== "function") return () => {};
      const fn = (_e, section) => cb(section);
      ipcRenderer.on("voice:section", fn);
      return () => ipcRenderer.removeListener("voice:section", fn);
    },
  }),
);
