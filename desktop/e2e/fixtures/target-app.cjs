/**
 * Another app to type into, for the voice typing e2e test: a window with a focused text box. It
 * writes what's in the box to TARGET_OUT whenever it changes, and the clipboard's text to
 * TARGET_CLIP every 200 ms, so the test can see what was pasted and whether the clipboard was put
 * back. It starts with "ORIGINAL CLIPBOARD" on the clipboard.
 */
const { app, BrowserWindow, clipboard, ipcMain } = require("electron");
const fs = require("node:fs");

const out = process.env.TARGET_OUT;
const clip = process.env.TARGET_CLIP;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 320,
    x: 120,
    y: 120,
    title: "Target app",
    webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false },
  });
  ipcMain.on("text", (_e, text) => fs.writeFileSync(out, text));
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><title>Target app</title><body style="margin:0;font:16px system-ui">
<textarea id="t" style="box-sizing:border-box;width:100%;height:100vh;padding:12px;border:0;font:inherit"></textarea>
<script>
  const { ipcRenderer } = require("electron");
  const t = document.getElementById("t");
  t.addEventListener("input", () => ipcRenderer.send("text", t.value));
  window.addEventListener("focus", () => t.focus());
  t.focus();
</script></body>`),
  );
  win.focus();
  win.webContents.focus();
  await clipboard.writeText("ORIGINAL CLIPBOARD");
  fs.writeFileSync(out, "");
  setInterval(async () => {
    try {
      fs.writeFileSync(clip, await clipboard.readText());
    } catch {
      /* the test ended */
    }
  }, 200);
  console.log("target ready");
});
