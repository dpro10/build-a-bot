/**
 * Preload for the hidden capture page (sandboxed). It can only send audio chunks,
 * levels and status to the main process; it can't receive the token or anything else.
 */
const { contextBridge, ipcRenderer } = require("electron");

const OUT = new Set(["chunk", "level", "track-ended", "flushed", "log"]);

contextBridge.exposeInMainWorld(
  "babCapture",
  Object.freeze({
    send(type, payload) {
      if (OUT.has(type)) ipcRenderer.send(`capture:${type}`, payload);
    },
  }),
);
