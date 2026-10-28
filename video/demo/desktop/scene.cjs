/**
 * The "computer" the desktop app is filmed on: a full-screen window with a calm wallpaper and one
 * ordinary app on it, made up for the video (no real company's app or logo):
 *   SCENE=compose   a "New message" window with its text box focused, for voice typing
 *   SCENE=call      a video call with three people in a browser-like window, for meeting notes
 * It's a separate app the Build-a-bot desktop app types into and floats above, as on a real desktop.
 * What's in the text box goes to SCENE_OUT whenever it changes. SCENE_CMD: JSON commands from the
 * recorder ({ n, speaking: "Maya" } lights up who's talking; { n, focus: true } focuses the box;
 * { n, clear: true } empties it).
 *
 *   electron video/demo/desktop/scene.cjs   (with SCENE, SCENE_OUT, SCENE_CMD)
 */
const { app, BrowserWindow, screen } = require("electron");
const fs = require("node:fs");

const scene = process.env.SCENE || "compose";
const out = process.env.SCENE_OUT || null;
const cmdFile = process.env.SCENE_CMD || null;

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: Inter, "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  body {
    background:
      radial-gradient(60% 70% at 15% 10%, rgb(124 92 255 / 0.55), transparent 70%),
      radial-gradient(55% 60% at 90% 15%, rgb(255 190 120 / 0.55), transparent 70%),
      radial-gradient(60% 60% at 70% 100%, rgb(80 170 255 / 0.45), transparent 70%),
      linear-gradient(160deg, #2b2457 0%, #3c3470 45%, #5b4a86 100%);
  }
  .win { position: absolute; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08), 0 30px 80px -20px rgb(10 6 30 / 0.55), 0 8px 24px -8px rgb(10 6 30 / 0.35); }
  .bar { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #f4f2f7; border-bottom: 1px solid #e6e2ec; font-size: 13px; font-weight: 600; color: #4b4757; }
  .dots { display: flex; gap: 7px; margin-right: 8px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; background: #d5d1dc; display: block; }
  .bar .title { flex: 1; text-align: center; margin-right: 52px; }
  /* compose */
  .compose { left: 50%; top: 46%; width: 760px; height: 470px; transform: translate(-50%, -50%); display: flex; flex-direction: column; }
  .field { display: flex; gap: 10px; padding: 12px 22px; border-bottom: 1px solid #efedf2; font-size: 15px; color: #2a2733; }
  .field b { color: #8a8596; font-weight: 500; width: 64px; }
  textarea { flex: 1; border: 0; outline: 0; resize: none; padding: 18px 22px; font-family: inherit; font-size: 21px; line-height: 1.55; font-weight: 400; color: #1b1824; caret-color: #6d4dff; }
  .send { position: absolute; right: 20px; bottom: 16px; padding: 9px 18px; border-radius: 10px; background: #6d4dff; color: #fff; font-size: 14px; font-weight: 600; }
  /* call */
  .call { left: 50%; top: 45%; width: 1000px; height: 560px; transform: translate(-50%, -50%); background: #17151f; display: flex; flex-direction: column; }
  .call .bar { background: #221f2c; border-color: #2e2a3a; color: #bdb8cc; }
  .call .bar .dots i { background: #3a3647; }
  .url { flex: 1; margin-right: 60px; height: 24px; border-radius: 8px; background: #17151f; color: #8f89a3; font-weight: 500; font-size: 12px; display: flex; align-items: center; padding: 0 12px; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px; }
  .tile { position: relative; border-radius: 14px; background: #262230; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 2px transparent; transition: box-shadow .15s ease; }
  .tile.on { box-shadow: inset 0 0 0 3px #7ee2b8; }
  .av { width: 96px; height: 96px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 36px; font-weight: 700; }
  .name { position: absolute; left: 12px; bottom: 10px; padding: 3px 9px; border-radius: 7px; background: rgb(0 0 0 / 0.45); color: #eee; font-size: 13px; font-weight: 600; }
  .controls { height: 64px; display: flex; align-items: center; justify-content: center; gap: 14px; }
  .controls span { width: 42px; height: 42px; border-radius: 50%; background: #2f2b3b; display: block; }
  .controls span.end { width: 64px; border-radius: 21px; background: #e5484d; }
`;

function html() {
  if (scene === "call") {
    const people = [
      ["Maya", "#e06c9f"],
      ["Diego", "#6d4dff"],
      ["Sam", "#2fa77a"],
    ];
    return `<div class="win call"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">meet.example.com/bio-lab-group</span></div>
      <div class="grid">${people.map(([n, c]) => `<div class="tile" data-who="${n}"><div class="av" style="background:${c}">${n[0]}</div><span class="name">${n}</span></div>`).join("")}</div>
      <div class="controls"><span></span><span></span><span></span><span class="end"></span></div></div>`;
  }
  return `<div class="win compose"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="title">New message</span></div>
    <div class="field"><b>To</b>Bio lab group</div><div class="field"><b>Subject</b>Lab report</div>
    <textarea id="t" spellcheck="false"></textarea><span class="send">Send</span></div>`;
}

app.whenReady().then(async () => {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow({ x: 0, y: 0, width, height, frame: false, show: false, backgroundColor: "#2b2457", webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false } });
  win.setMenu(null);
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><title>Desktop</title><style>${CSS}</style><body>${html()}
<script>
  const { ipcRenderer } = require("electron");
  const t = document.getElementById("t");
  if (t) { t.addEventListener("input", () => ipcRenderer.send("text", t.value)); t.focus(); window.addEventListener("focus", () => t.focus()); }
  window.run = (c) => {
    if (c.speaking !== undefined) for (const el of document.querySelectorAll(".tile")) el.classList.toggle("on", el.dataset.who === c.speaking);
    if (c.focus && t) t.focus();
    if (c.clear && t) { t.value = ""; ipcRenderer.send("text", ""); }
  };
</script></body>`),
  );
  win.show();
  win.focus();
  // The mouse pointer, drawn like the web recordings' one, wherever the real pointer is: a
  // see-through window that clicks go through, kept above the desktop app's own windows (titled
  // "video-cursor", so the recorder can raise it).
  const cursor = new BrowserWindow({ title: "video-cursor", x: 0, y: 0, width, height, frame: false, transparent: true, focusable: false, hasShadow: false, show: false, webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false } });
  cursor.setIgnoreMouseEvents(true);
  await cursor.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><title>video-cursor</title><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.c{position:fixed;left:0;top:0;width:30px;height:30px;will-change:transform}.c svg{display:block;filter:drop-shadow(0 2px 3px rgba(20,16,40,.32))}</style>
<div class="c"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M5 3.5 L5 23.5 L10.2 18.6 L13.9 26.6 L17.6 25 L13.9 17.1 L21 17.1 Z" fill="#14121f" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
<script>const c=document.querySelector(".c");window.at=(x,y)=>{c.style.transform="translate("+(x-5)+"px,"+(y-4)+"px)"};</script>`),
  );
  cursor.showInactive();
  const { screen: scr } = require("electron");
  setInterval(() => {
    const p = scr.getCursorScreenPoint();
    cursor.webContents.executeJavaScript(`at(${p.x},${p.y})`).catch(() => {});
  }, 16);
  // With no window manager, Electron can't restack; the recorder raises this window (xdotool).
  require("electron").ipcMain.on("text", (_e, text) => out && fs.writeFileSync(out, text));
  if (out) fs.writeFileSync(out, "");
  if (cmdFile) {
    let last = -1;
    setInterval(async () => {
      let c;
      try {
        c = JSON.parse(fs.readFileSync(cmdFile, "utf8"));
      } catch {
        return;
      }
      if (c.n === last) return;
      last = c.n;
      if (c.focus) win.focus();
      await win.webContents.executeJavaScript(`window.run(${JSON.stringify(c)})`).catch(() => {});
    }, 50);
  }
});
