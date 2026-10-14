/**
 * Preload for the buddy page (<server>/desktop/buddy), sandboxed. It puts exactly the
 * BabDesktopApi from the web app's src/components/meetings/desktop-api.ts on
 * window.babDesktop: onState, act, setInteractive, copy. Nothing else: no Node, no
 * token, no files.
 */
const { contextBridge, ipcRenderer } = require("electron");

const ACTIONS = new Set(["take", "dismiss", "never", "pause", "resume", "stop", "discard", "open", "hide"]);

let current = null;
const listeners = new Set();

ipcRenderer.on("buddy:state", (_event, state) => {
  current = state;
  for (const cb of listeners) {
    try {
      cb(state);
    } catch (err) {
      console.error(err);
    }
  }
});

contextBridge.exposeInMainWorld(
  "babDesktop",
  Object.freeze({
    /** Subscribe to state; called immediately with the current state. Returns an unsubscribe function. */
    onState(cb) {
      if (typeof cb !== "function") return () => {};
      listeners.add(cb);
      if (!current) {
        try {
          current = ipcRenderer.sendSync("buddy:get-state");
        } catch {
          current = null;
        }
      }
      if (current) {
        try {
          cb(current);
        } catch (err) {
          console.error(err);
        }
      }
      return () => {
        listeners.delete(cb);
      };
    },
    act(action) {
      if (typeof action === "string" && ACTIONS.has(action)) ipcRenderer.send("buddy:act", action);
    },
    setInteractive(on) {
      ipcRenderer.send("buddy:interactive", on === true);
    },
    copy(text) {
      if (typeof text === "string" && text.length > 0 && text.length <= 2000) ipcRenderer.send("buddy:copy", text);
    },
  }),
);
