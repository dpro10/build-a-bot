/**
 * Reading the text box voice typing just typed into, for learning from a fix (fix-watch.mjs).
 * Only on this computer, and only that box:
 *
 *   macOS:   the app's Swift helper (`bab-audio-helper text`, native/macos), with Accessibility,
 *            which voice typing already has for pasting
 *   Windows: UI Automation, from one small PowerShell process kept running (like front-app.mjs)
 *   Linux:   not yet (`supported` is false)
 *
 * Commands go one a line (ping, prime, focus, read, forget) and each gets one JSON line back:
 *   { ok: true, value, selection?: { location, length }, role?, focused?, pid? }
 *   { ok: false, error: "secure" | "no-focus" | "no-value" | "too-long" | "gone" | "not-trusted" | … }
 * One request at a time. A helper that doesn't answer is stopped and started again next time;
 * one that keeps dying is left alone; one left idle for a while stops (it starts again when the
 * owner next dictates). What's read is never logged.
 */
import { spawn as nodeSpawn } from "node:child_process";

/** Longer boxes aren't read (a whole document isn't where a dictated word gets fixed). */
export const MAX_CHARS = 20_000;

/**
 * The Windows helper: UI Automation's focused element, kept between commands. Password boxes
 * (IsPassword) are refused. TextPattern gives the text and the caret; ValuePattern the text only.
 * Some apps report the focus on a container (Windows 11's Notepad: its window's pane): then the
 * text control inside it that has the keyboard focus, or its only one.
 */
export const WIN_TEXT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$max = ${MAX_CHARS}
$script:el = $null
function Send($o) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 4))
  [Console]::Out.Flush()
}
function Has-Text($e) {
  $p = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p)) { return $true }
  return $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)
}
function Find-Text($f) {
  if (Has-Text $f) { return $f }
  $keyboard = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, $true)
  $inner = $f.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $keyboard)
  if ($inner -ne $null -and (Has-Text $inner)) { return $inner }
  $isDoc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
  $isEdit = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $all = $f.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]@($isDoc, $isEdit)))
  if ($all.Count -eq 1 -and (Has-Text $all[0])) { return $all[0] }
  return $f
}
function Get-Box($e, $full) {
  $c = $e.Current
  if ($c.IsPassword) { return @{ ok = $false; error = 'secure' } }
  $value = $null
  $sel = $null
  $tp = $null
  $vp = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
    $doc = $tp.DocumentRange
    $value = $doc.GetText($max + 1)
    try {
      $ranges = $tp.GetSelection()
      if ($ranges -and $ranges.Length -gt 0) {
        $pre = $doc.Clone()
        $pre.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $ranges[0], [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
        $sel = @{ location = $pre.GetText($max + 1).Length; length = $ranges[0].GetText($max + 1).Length }
      }
    } catch { $sel = $null }
  } elseif ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
    $value = $vp.Current.Value
  }
  if ($value -eq $null) { return @{ ok = $false; error = 'no-value'; role = $c.ControlType.ProgrammaticName } }
  if ($value.Length -gt $max) { return @{ ok = $false; error = 'too-long' } }
  $out = @{ ok = $true; value = [string]$value; role = $c.ControlType.ProgrammaticName }
  if ($sel -ne $null) { $out.selection = $sel }
  if ($full) { $out.pid = $c.ProcessId }
  try { $out.focused = [System.Windows.Automation.Automation]::Compare($e, [System.Windows.Automation.AutomationElement]::FocusedElement) } catch { $out.focused = $false }
  return $out
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $cmd = $line.Trim()
  try {
    if ($cmd -eq 'ping') { Send @{ ok = $true; trusted = $true } }
    elseif ($cmd -eq 'prime') {
      # Asking for the focused element is what makes Chromium and Electron apps build their
      # accessibility tree; done while the owner talks, it's ready by the time the words are typed.
      $f = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($f -ne $null) { $null = $f.Current.ControlType }
      Send @{ ok = $true }
    }
    elseif ($cmd -eq 'focus') {
      $script:el = $null
      $f = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($f -eq $null) { Send @{ ok = $false; error = 'no-focus' } }
      else { $f = Find-Text $f; $script:el = $f; Send (Get-Box $f $true) }
    }
    elseif ($cmd -eq 'read') {
      if ($script:el -eq $null) { Send @{ ok = $false; error = 'no-element' } }
      else { Send (Get-Box $script:el $false) }
    }
    elseif ($cmd -eq 'forget') { $script:el = $null; Send @{ ok = $true } }
    else { Send @{ ok = $false; error = 'unknown' } }
  } catch [System.Windows.Automation.ElementNotAvailableException] {
    $script:el = $null
    Send @{ ok = $false; error = 'gone' }
  } catch {
    Send @{ ok = $false; error = 'failed' }
  }
}
`;

/**
 * One line from a helper, as a reply (never throws).
 * @param {string} line
 */
export function parseReply(line) {
  try {
    const v = JSON.parse(String(line).replace(/^﻿/, ""));
    if (!v || typeof v !== "object" || typeof v.ok !== "boolean") return { ok: false, error: "unreadable" };
    if (v.ok && v.value !== undefined && typeof v.value !== "string") return { ok: false, error: "unreadable" };
    if (v.ok && typeof v.value === "string" && v.value.length > MAX_CHARS) return { ok: false, error: "too-long" };
    const sel = v.selection;
    if (sel && !(Number.isFinite(sel.location) && Number.isFinite(sel.length) && sel.location >= 0 && sel.length >= 0)) delete v.selection;
    return v;
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

export class TextReader {
  /**
   * @param {object} [o]
   * @param {string} [o.platform]
   * @param {string | null} [o.macHelper]  the helper binary (macOS)
   * @param {typeof nodeSpawn} [o.spawn]
   * @param {(m: string) => void} [o.log]
   * @param {number} [o.timeoutMs]  for each answer
   * @param {number} [o.startMs]  for the first answer after starting (PowerShell takes a moment)
   * @param {number} [o.idleMs]  stop the helper after this long without a question
   */
  constructor(o = {}) {
    this.platform = o.platform ?? process.platform;
    this.macHelper = o.macHelper ?? null;
    this.spawn = o.spawn ?? nodeSpawn;
    this.log = o.log ?? (() => {});
    this.timeoutMs = o.timeoutMs ?? 3000;
    this.startMs = o.startMs ?? 15_000;
    this.idleMs = o.idleMs ?? 10 * 60_000;
    /** @type {any} */
    this.idleTimer = null;
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;
    this.fresh = false;
    this.buf = "";
    /** @type {null | { resolve: (v: any) => void, timer: any }} */
    this.pending = null;
    this.queue = Promise.resolve();
    /** When it died lately: after three in ten minutes it's left alone. */
    this.deaths = /** @type {number[]} */ ([]);
    this.disposed = false;
  }

  get supported() {
    if (this.platform === "darwin") return Boolean(this.macHelper);
    return this.platform === "win32";
  }

  get broken() {
    const recent = this.deaths.filter((t) => Date.now() - t < 10 * 60_000);
    return recent.length >= 3;
  }

  /**
   * While the owner talks: start the helper, and have the app they'll type into get its
   * accessibility tree ready (Chromium and Electron apps build it only when asked), so both are
   * ready by the time the words are typed. Reads nothing.
   */
  warm() {
    if (!this.supported || this.broken || this.disposed) return Promise.resolve({ ok: false, error: "unavailable" });
    return this.ask("prime");
  }

  /** The focused text box: remember it and read it. */
  focus() {
    return this.ask("focus");
  }

  /** The remembered box, again. */
  read() {
    return this.ask("read");
  }

  forget() {
    return this.ask("forget");
  }

  /** The helper answers (and, on a Mac, whether Accessibility is allowed). */
  ping() {
    return this.ask("ping");
  }

  /** @param {'focus'|'read'|'forget'|'ping'|'prime'} cmd */
  ask(cmd) {
    const run = () => this.askNow(cmd);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** @returns {Promise<any>} */
  askNow(cmd) {
    if (!this.supported) return Promise.resolve({ ok: false, error: "unsupported" });
    if (this.disposed || this.broken) return Promise.resolve({ ok: false, error: "unavailable" });
    if (!this.child) this.start();
    const child = this.child;
    if (!child?.stdin) return Promise.resolve({ ok: false, error: "unavailable" });
    const wait = this.fresh ? this.startMs : this.timeoutMs;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer !== timer) return;
        this.pending = null;
        this.log(`learn: the text reader didn't answer in ${wait} ms; restarting it`);
        this.kill();
        resolve({ ok: false, error: "timeout" });
      }, wait);
      this.pending = { resolve, timer };
      try {
        child.stdin.write(`${cmd}\n`);
      } catch {
        clearTimeout(timer);
        this.pending = null;
        resolve({ ok: false, error: "unavailable" });
      }
    });
  }

  start() {
    let child;
    try {
      if (this.platform === "darwin") {
        child = this.spawn(/** @type {string} */ (this.macHelper), ["text"], { stdio: ["pipe", "pipe", "ignore"] });
      } else {
        const encoded = Buffer.from(WIN_TEXT_SCRIPT, "utf16le").toString("base64");
        child = this.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-MTA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      }
    } catch (err) {
      this.died(`couldn't start (${/** @type {any} */ (err)?.code ?? err})`);
      return;
    }
    this.child = child;
    this.fresh = true;
    this.buf = "";
    this.idle();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (this.child !== child) return;
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        this.fresh = false;
        this.idle();
        const p = this.pending;
        if (!p) continue;
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve(parseReply(line));
      }
    });
    child.stdin?.on("error", () => {});
    child.on("error", (err) => {
      if (this.child === child) this.died(`failed (${/** @type {any} */ (err)?.code ?? err})`);
    });
    child.on("exit", (code) => {
      if (this.child === child) this.died(`stopped (exit ${code})`);
    });
  }

  died(why) {
    this.log(`learn: the text reader ${why}`);
    this.child = null;
    this.deaths.push(Date.now());
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "unavailable" });
    }
  }

  /** (Re)start the countdown to stopping an idle helper. */
  idle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.pending) this.kill();
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  kill() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.child;
    this.child = null;
    try {
      child?.kill();
    } catch {
      /* gone */
    }
  }

  /** Stop the helper (learning turned off); it starts again when next needed. */
  stop() {
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "unavailable" });
    }
    this.kill();
  }

  dispose() {
    this.disposed = true;
    this.stop();
  }
}
