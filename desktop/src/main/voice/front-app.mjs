/**
 * Which app the owner is typing in, so the words fit it: casual in chats, proper sentences in
 * email, exact in code. Only the kind of app ("chat") and its name ("Slack") go to the server
 * with the recording; window titles are read on Windows and Linux to tell Gmail from other tabs,
 * and never leave the computer.
 *
 *   macOS:   lsappinfo (no permission needed)
 *   Windows: GetForegroundWindow, from one small PowerShell process kept running
 *   Linux:   xprop (X11)
 *
 * Parsing and the app lists are pure, so they're tested; FrontApp runs the commands.
 */
import { spawn } from "node:child_process";
import { execText } from "../detect/index.mjs";

/** @typedef {'chat'|'email'|'code'|'terminal'|'docs'|'browser'|'other'} Category */
/** @typedef {{ name: string, category: Category }} FrontAppInfo */

/** Apps by macOS bundle id, Windows exe (no .exe) or Linux WM_CLASS, all lowercase. */
const APPS = /** @type {Array<[Category, string, string[]]>} */ ([
  // [category, display name, ids]
  ["chat", "Slack", ["com.tinyspeck.slackmacgap", "slack"]],
  ["chat", "Discord", ["com.hnc.discord", "discord"]],
  ["chat", "Messages", ["com.apple.mobilesms"]],
  ["chat", "WhatsApp", ["net.whatsapp.whatsapp", "desktop.whatsapp", "whatsapp", "whatsapp.root"]],
  ["chat", "Telegram", ["ru.keepcoder.telegram", "org.telegram.desktop", "telegram", "telegramdesktop", "telegram-desktop"]],
  ["chat", "Teams", ["com.microsoft.teams2", "com.microsoft.teams", "ms-teams", "teams", "msteams"]],
  ["chat", "Signal", ["org.whispersystems.signal-desktop", "signal"]],
  ["chat", "Messenger", ["com.facebook.archon", "messenger"]],
  ["chat", "Element", ["im.riot.app", "element"]],
  ["chat", "Zoom", ["us.zoom.xos", "zoom"]],
  ["email", "Mail", ["com.apple.mail"]],
  ["email", "Outlook", ["com.microsoft.outlook", "outlook", "olk"]],
  ["email", "Thunderbird", ["org.mozilla.thunderbird", "thunderbird"]],
  ["email", "Spark", ["com.readdle.smartemail-mac", "com.readdle.sparkdesktop", "spark"]],
  ["email", "Superhuman", ["com.superhuman.electron", "superhuman"]],
  ["email", "Mimestream", ["com.mimestream.mimestream"]],
  ["email", "HEY", ["com.hey.app.desktop", "hey"]],
  ["code", "VS Code", ["com.microsoft.vscode", "com.microsoft.vscodeinsiders", "code", "code - insiders", "code-oss"]],
  ["code", "Cursor", ["com.todesktop.230313mzl4w4u92", "cursor"]],
  ["code", "Windsurf", ["com.exafunction.windsurf", "windsurf"]],
  ["code", "Zed", ["dev.zed.zed", "zed"]],
  ["code", "Xcode", ["com.apple.dt.xcode"]],
  ["code", "Sublime Text", ["com.sublimetext.4", "com.sublimetext.3", "sublime_text"]],
  ["code", "Android Studio", ["com.google.android.studio", "studio64"]],
  ["code", "IntelliJ IDEA", ["com.jetbrains.intellij", "com.jetbrains.intellij.ce", "idea64", "jetbrains-idea"]],
  ["code", "PyCharm", ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce", "pycharm64", "jetbrains-pycharm"]],
  ["code", "WebStorm", ["com.jetbrains.webstorm", "webstorm64", "jetbrains-webstorm"]],
  ["terminal", "Terminal", ["com.apple.terminal", "gnome-terminal-server", "org.gnome.terminal", "org.gnome.console", "kgx"]],
  ["terminal", "iTerm", ["com.googlecode.iterm2"]],
  ["terminal", "Warp", ["dev.warp.warp-stable", "warp"]],
  ["terminal", "Ghostty", ["com.mitchellh.ghostty", "ghostty"]],
  ["terminal", "Windows Terminal", ["windowsterminal", "openconsole", "cmd", "powershell", "pwsh", "conhost"]],
  ["terminal", "Kitty", ["net.kovidgoyal.kitty", "kitty"]],
  ["terminal", "Alacritty", ["org.alacritty", "alacritty"]],
  ["terminal", "WezTerm", ["com.github.wez.wezterm", "wezterm-gui", "org.wezfurlong.wezterm"]],
  ["terminal", "Konsole", ["konsole", "org.kde.konsole"]],
  ["terminal", "Terminal", ["xterm", "tilix", "terminator", "xfce4-terminal", "mate-terminal", "lxterminal", "foot"]],
  ["docs", "Notes", ["com.apple.notes"]],
  ["docs", "Word", ["com.microsoft.word", "winword"]],
  ["docs", "Pages", ["com.apple.iwork.pages"]],
  ["docs", "Notion", ["notion.id", "notion"]],
  ["docs", "Obsidian", ["md.obsidian", "obsidian"]],
  ["docs", "Bear", ["net.shinyfrog.bear"]],
  ["docs", "TextEdit", ["com.apple.textedit"]],
  ["docs", "Notepad", ["notepad", "notepad++"]],
  ["docs", "Craft", ["com.lukilabs.lukiapp"]],
  ["docs", "Scrivener", ["com.literatureandlatte.scrivener3", "scrivener"]],
  ["docs", "LibreOffice", ["soffice", "libreoffice", "libreoffice-writer", "soffice.bin"]],
  ["docs", "Linear", ["com.linear", "linear"]],
  ["browser", "Chrome", ["com.google.chrome", "com.google.chrome.canary", "chrome", "google-chrome"]],
  ["browser", "Safari", ["com.apple.safari", "com.apple.safaritechnologypreview"]],
  ["browser", "Arc", ["company.thebrowser.browser", "arc"]],
  ["browser", "Edge", ["com.microsoft.edgemac", "msedge", "microsoft-edge"]],
  ["browser", "Firefox", ["org.mozilla.firefox", "firefox", "navigator"]],
  ["browser", "Brave", ["com.brave.browser", "brave", "brave-browser"]],
  ["browser", "Opera", ["com.operasoftware.opera", "opera"]],
  ["browser", "Vivaldi", ["com.vivaldi.vivaldi", "vivaldi", "vivaldi-stable"]],
  ["browser", "Chromium", ["org.chromium.chromium", "chromium", "chromium-browser"]],
  ["browser", "Dia", ["company.thebrowser.dia"]],
  ["browser", "Comet", ["ai.perplexity.comet", "comet"]],
]);

const BY_ID = new Map();
for (const [category, name, ids] of APPS) for (const id of ids) BY_ID.set(id, { name, category });

/** A browser tab's title says what the page is (Windows and Linux; macOS doesn't tell without asking). */
const TAB_TITLES = /** @type {Array<[Category, string, RegExp]>} */ ([
  ["email", "Gmail", /\bgmail\b|\binbox\b.*\b(?:gmail|google)\b/i],
  ["email", "Outlook", /\boutlook\b|\bmail - /i],
  ["email", "Email", /\b(?:proton ?mail|yahoo mail|fastmail|superhuman|hey\.com)\b/i],
  ["chat", "Slack", /\bslack\b/i],
  ["chat", "Discord", /\bdiscord\b/i],
  ["chat", "WhatsApp", /\bwhatsapp\b/i],
  ["chat", "Messenger", /\bmessenger\b/i],
  ["chat", "Teams", /\bmicrosoft teams\b/i],
  ["chat", "Google Chat", /\bgoogle chat\b/i],
  ["chat", "ChatGPT", /\bchatgpt\b/i],
  ["chat", "Claude", /\bclaude\b/i],
  ["docs", "Google Docs", /\bgoogle docs\b/i],
  ["docs", "Notion", /\bnotion\b/i],
  ["docs", "Confluence", /\bconfluence\b/i],
  ["docs", "Word", /\bword\b.*\b(?:microsoft|office)\b|\bmicrosoft word\b/i],
]);

/**
 * The kind of app and its name.
 * @param {{ id?: string | null, name?: string | null, title?: string | null }} app
 * @returns {FrontAppInfo}
 */
export function categorize(app) {
  const id = String(app.id ?? "")
    .toLowerCase()
    .replace(/\.exe$/, "")
    .trim();
  let hit = BY_ID.get(id);
  // JetBrains and other families: com.jetbrains.goland, com.jetbrains.rider…
  if (!hit && /^com\.jetbrains\./.test(id)) hit = { name: app.name || "JetBrains", category: "code" };
  if (hit?.category === "browser" && app.title) {
    for (const [category, name, re] of TAB_TITLES) if (re.test(app.title)) return { name, category };
  }
  if (hit) return hit;
  const name = String(app.name ?? "").trim();
  return { name: name.slice(0, 40), category: "other" };
}

/**
 * `lsappinfo info -only bundleid -only name <asn>`:
 *   "CFBundleIdentifier"="com.tinyspeck.slackmacgap"
 *   "LSDisplayName"="Slack"
 */
export function parseLsappinfo(text) {
  const id = String(text).match(/"CFBundleIdentifier"\s*=\s*"([^"]*)"/)?.[1] ?? null;
  const name = String(text).match(/"LSDisplayName"\s*=\s*"([^"]*)"/)?.[1] ?? null;
  return { id, name };
}

/** `lsappinfo front` → "ASN:0x0-0x1d01d:" */
export function parseAsn(text) {
  return String(text).match(/ASN:0x[0-9a-f]+-0x[0-9a-f]+:?/i)?.[0] ?? null;
}

/** `xprop -root _NET_ACTIVE_WINDOW` → "_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007" */
export function parseActiveWindow(text) {
  const id = String(text).match(/window id # (0x[0-9a-f]+)/i)?.[1] ?? null;
  return id && !/^0x0+$/i.test(id) ? id : null;
}

/**
 * `xprop -id <id> WM_CLASS _NET_WM_NAME`:
 *   WM_CLASS(STRING) = "slack", "Slack"
 *   _NET_WM_NAME(UTF8_STRING) = "general - Slack"
 */
export function parseXpropWindow(text) {
  const cls = String(text).match(/WM_CLASS\(STRING\) = "([^"]*)"(?:, "([^"]*)")?/);
  const title = String(text).match(/_NET_WM_NAME\(UTF8_STRING\) = "((?:[^"\\]|\\.)*)"/)?.[1] ?? null;
  return { id: cls?.[1] ?? null, name: cls?.[2] ?? cls?.[1] ?? null, title };
}

/** A line from the Windows helper: "slack|general - Slack". */
export function parseWinForeground(line) {
  const i = String(line).indexOf("|");
  if (i < 0) return { id: null, name: null, title: null };
  const exe = line.slice(0, i).trim();
  return { id: exe || null, name: exe || null, title: line.slice(i + 1).trim() || null };
}

/** The Windows helper: answers each line on stdin with "exe|window title" for the window in front. */
const WIN_SCRIPT = `
$sig = @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int n);
'@
Add-Type -MemberDefinition $sig -Name W -Namespace Bab
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $h = [Bab.W]::GetForegroundWindow()
  $p = 0
  [void][Bab.W]::GetWindowThreadProcessId($h, [ref]$p)
  $sb = New-Object System.Text.StringBuilder 512
  [void][Bab.W]::GetWindowText($h, $sb, 512)
  $name = ''
  try { $name = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine("$name|$($sb.ToString())")
  [Console]::Out.Flush()
}
`;

export class FrontApp {
  /**
   * @param {{ platform?: string, exec?: typeof execText, log?: (m: string) => void }} [o]
   */
  constructor(o = {}) {
    this.platform = o.platform ?? process.platform;
    this.exec = o.exec ?? execText;
    this.log = o.log ?? (() => {});
    /** @type {import('node:child_process').ChildProcess | null} */
    this.win = null;
    /** @type {Array<(line: string) => void>} */
    this.waiting = [];
    this.winBuf = "";
    this.broken = false;
  }

  /**
   * The app in front right now, or null when it can't tell (within `timeoutMs`).
   * @returns {Promise<FrontAppInfo | null>}
   */
  async detect(timeoutMs = 1500) {
    if (this.broken) return null;
    const work = this.read().catch((err) => {
      this.log(`voice: couldn't tell which app is in front (${/** @type {any} */ (err)?.code ?? err})`);
      return null;
    });
    const raw = await Promise.race([work, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    return raw ? categorize(/** @type {any} */ (raw)) : null;
  }

  async read() {
    if (this.platform === "darwin") {
      const asn = parseAsn(await this.exec("lsappinfo", ["front"], { timeout: 1500 }));
      if (!asn) return null;
      return parseLsappinfo(await this.exec("lsappinfo", ["info", "-only", "bundleid", "-only", "name", asn], { timeout: 1500 }));
    }
    if (this.platform === "win32") return parseWinForeground(await this.askWindows());
    if (this.platform === "linux") {
      if (!process.env.DISPLAY) return null;
      const id = parseActiveWindow(await this.exec("xprop", ["-root", "_NET_ACTIVE_WINDOW"], { timeout: 1500 }));
      if (!id) return null;
      return parseXpropWindow(await this.exec("xprop", ["-id", id, "WM_CLASS", "_NET_WM_NAME"], { timeout: 1500 }));
    }
    return null;
  }

  /** @returns {Promise<string>} */
  askWindows() {
    if (!this.win || this.win.exitCode !== null) this.startWindowsHelper();
    return new Promise((resolve, reject) => {
      const w = this.win;
      if (!w?.stdin) return reject(new Error("no helper"));
      this.waiting.push(resolve);
      w.stdin.write("q\n");
    });
  }

  startWindowsHelper() {
    const encoded = Buffer.from(WIN_SCRIPT, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    this.win = child;
    this.winBuf = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      this.winBuf += chunk;
      let i;
      while ((i = this.winBuf.indexOf("\n")) >= 0) {
        const line = this.winBuf.slice(0, i).replace(/\r$/, "");
        this.winBuf = this.winBuf.slice(i + 1);
        this.waiting.shift()?.(line);
      }
    });
    child.on("error", () => {
      this.broken = true;
      for (const w of this.waiting.splice(0)) w("|");
    });
    child.on("exit", () => {
      for (const w of this.waiting.splice(0)) w("|");
      if (this.win === child) this.win = null;
    });
  }

  dispose() {
    try {
      this.win?.kill();
    } catch {
      /* gone */
    }
    this.win = null;
  }
}
