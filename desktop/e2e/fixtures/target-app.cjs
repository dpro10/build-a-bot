/**
 * Another app to type into, for the voice typing e2e tests: a window with a focused text box. It
 * writes what's in the box to TARGET_OUT whenever it changes, and the clipboard's text to
 * TARGET_CLIP every 200 ms, so the test can see what was pasted and whether the clipboard was put
 * back. It starts with "ORIGINAL CLIPBOARD" on the clipboard.
 *
 * For the learning-from-fixes tests, it can also:
 *  - show a password box under the text box (TARGET_PASSWORD=1);
 *  - do what a person does with the mouse, from commands the test writes to TARGET_CMD as JSON
 *    ({ n, cmd: "select", text } selects the last place `text` is in the box, as a double-click
 *    would; { n, cmd: "set", value } fills the box, caret at the end; { n, cmd: "caret", at } puts
 *    the caret there, as a click would; { n, cmd: "focus", id: "t"|"p" } clicks into the box or the
 *    password box; { n, cmd: "front" } clicks on its window, bringing it to the front; { n, cmd:
 *    "clip", text } copies text, as another app would). It writes `n` to TARGET_CMD + ".done" once
 *    done (`n failed: why` if not).
 */
const { app, BrowserWindow, clipboard, ipcMain } = require("electron");
const fs = require("node:fs");

const out = process.env.TARGET_OUT;
const clip = process.env.TARGET_CLIP;
const cmdFile = process.env.TARGET_CMD || null;
const password = process.env.TARGET_PASSWORD === "1";

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 320,
    x: 120,
    y: 120,
    title: "Target app",
    webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false },
  });
  // No menu bar (Windows and Linux): Alt never sends the keyboard there.
  win.setMenu(null);
  ipcMain.on("text", (_e, text) => out && fs.writeFileSync(out, text));
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><title>Target app</title><body style="margin:0;font:16px system-ui">
<textarea id="t" style="box-sizing:border-box;width:100%;height:${password ? "calc(100vh - 48px)" : "100vh"};padding:12px;border:0;font:inherit"></textarea>
${password ? '<input id="p" type="password" aria-label="Password" style="box-sizing:border-box;width:100%;height:48px;padding:12px;font:inherit">' : ""}
<script>
  const { ipcRenderer } = require("electron");
  const t = document.getElementById("t");
  const report = () => ipcRenderer.send("text", t.value);
  t.addEventListener("input", report);
  window.addEventListener("focus", () => (document.activeElement === document.body ? t.focus() : null));
  t.focus();
  window.run = (c) => {
    if (c.cmd === "set") {
      t.focus();
      t.value = c.value;
      t.setSelectionRange(c.value.length, c.value.length);
      report();
    } else if (c.cmd === "select") {
      t.focus();
      const at = t.value.lastIndexOf(c.text);
      if (at < 0) throw new Error("not in the box: " + c.text);
      t.setSelectionRange(at, at + c.text.length);
    } else if (c.cmd === "caret") {
      t.focus();
      if (!(c.at >= 0 && c.at <= t.value.length)) throw new Error("no such place in the box: " + c.at);
      t.setSelectionRange(c.at, c.at);
    } else if (c.cmd === "focus") {
      document.getElementById(c.id).focus();
    }
  };
</script></body>`),
  );
  win.focus();
  win.webContents.focus();
  await clipboard.writeText("ORIGINAL CLIPBOARD");
  if (out) fs.writeFileSync(out, "");
  if (clip) {
    setInterval(async () => {
      try {
        fs.writeFileSync(clip, await clipboard.readText());
      } catch {
        /* the test ended */
      }
    }, 200);
  }
  if (cmdFile) {
    let last = null;
    setInterval(async () => {
      let c;
      try {
        c = JSON.parse(fs.readFileSync(cmdFile, "utf8"));
      } catch {
        return;
      }
      if (!c || c.n === last) return;
      last = c.n;
      try {
        if (c.cmd === "front") {
          app.focus({ steal: true });
          win.show();
          win.focus();
          win.webContents.focus();
        } else if (c.cmd === "clip") clipboard.writeText(String(c.text));
        else await win.webContents.executeJavaScript(`window.run(${JSON.stringify(c)})`);
        fs.writeFileSync(`${cmdFile}.done`, String(c.n));
      } catch (err) {
        fs.writeFileSync(`${cmdFile}.done`, `${c.n} failed: ${err?.message ?? err}`);
      }
    }, 100);
  }
  console.log(`target ready ${process.pid}`);
});
