/**
 * Reading the text box voice typing types into: the box it just typed into, for learning from a
 * fix (fix-watch.mjs), and, right before it types, the few characters next to the cursor, so the
 * words don't run into the ones there (spacing.mjs). Only on this computer, and only that box:
 *
 *   macOS:   the app's Swift helper (`bab-audio-helper text`, native/macos), with Accessibility,
 *            which voice typing already has for pasting
 *   Windows: UI Automation, from one small PowerShell process kept running (like front-app.mjs)
 *   Linux:   not yet (`supported` is false)
 *
 * Commands go one a line (ping, prime, focus, read, forget, around) and each gets one JSON line
 * back:
 *   { ok: true, value, selection?: { location, length }, role?, focused?, pid? }
 *   { ok: true, before, after }   (around: up to 4 characters before the cursor or the selection,
 *                                   2 after; nothing else of the box leaves the helper)
 *   { ok: false, error: "secure" | "no-focus" | "no-value" | "no-caret" | "too-long" | "gone" | "not-trusted" | … }
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
 * Classic Windows text boxes (Edit and RichEdit: Notepad's, WordPad's, most older apps') show up
 * in .NET's UI Automation as bare panes, so they're read the classic way, with window messages
 * (WM_GETTEXT, EM_GETSEL; a password box, ES_PASSWORD or a password character, is refused). An
 * app that reports the focus on a container: the text control inside it that has the keyboard
 * focus, or its only one.
 *
 * `around` reads only the characters next to the cursor: with TextPattern, a range a few
 * characters long on each side of the selection; a classic box's text, cut down to them there;
 * a ValuePattern box (no caret) tells only when it's empty.
 */
export const WIN_TEXT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BabEditBox {
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
  static extern IntPtr Send(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)]
  static extern IntPtr SendText(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
  static extern int GetStyle(IntPtr hWnd, int index);
  const uint AbortIfHung = 2, Wait = 500;
  public static bool IsPassword(IntPtr h) {
    if ((GetStyle(h, -16) & 0x20) != 0) return true;
    IntPtr ch;
    return Send(h, 0xD2, IntPtr.Zero, IntPtr.Zero, AbortIfHung, Wait, out ch) != IntPtr.Zero && ch != IntPtr.Zero;
  }
  public static int Length(IntPtr h) {
    IntPtr n;
    return Send(h, 0x0E, IntPtr.Zero, IntPtr.Zero, AbortIfHung, Wait, out n) == IntPtr.Zero ? -1 : (int)n.ToInt64();
  }
  public static string Text(IntPtr h, int length) {
    StringBuilder text = new StringBuilder(length + 1);
    IntPtr got;
    return SendText(h, 0x0D, (IntPtr)(length + 1), text, AbortIfHung, Wait, out got) == IntPtr.Zero ? null : text.ToString();
  }
  public static int[] Selection(IntPtr h) {
    IntPtr r;
    if (Send(h, 0xB0, IntPtr.Zero, IntPtr.Zero, AbortIfHung, Wait, out r) == IntPtr.Zero) return null;
    long v = r.ToInt64();
    int start = (int)(v & 0xFFFF), end = (int)((v >> 16) & 0xFFFF);
    return end >= start ? new int[] { start, end - start } : null;
  }
}
'@
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$max = ${MAX_CHARS}
$script:el = $null
function Send($o) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 4))
  [Console]::Out.Flush()
}
function Edit-Handle($c) {
  if ($c.NativeWindowHandle -ne 0 -and $c.ClassName -match '^(Edit|RichEdit|RICHEDIT)') { return [IntPtr]$c.NativeWindowHandle }
  return [IntPtr]::Zero
}
function Has-Text($e) {
  $p = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p)) { return $true }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { return $true }
  return (Edit-Handle $e.Current) -ne [IntPtr]::Zero
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
  } else {
    $h = Edit-Handle $c
    if ($h -ne [IntPtr]::Zero) {
      if ([BabEditBox]::IsPassword($h)) { return @{ ok = $false; error = 'secure' } }
      $n = [BabEditBox]::Length($h)
      if ($n -gt $max) { return @{ ok = $false; error = 'too-long' } }
      if ($n -ge 0) { $value = [BabEditBox]::Text($h, $n) }
      $range = [BabEditBox]::Selection($h)
      if ($value -ne $null -and $range -ne $null) { $sel = @{ location = $range[0]; length = $range[1] } }
    }
  }
  if ($value -eq $null) { return @{ ok = $false; error = 'no-value'; role = $c.ControlType.ProgrammaticName } }
  if ($value.Length -gt $max) { return @{ ok = $false; error = 'too-long' } }
  $out = @{ ok = $true; value = [string]$value; role = $c.ControlType.ProgrammaticName }
  if ($sel -ne $null) { $out.selection = $sel }
  if ($full) { $out.pid = $c.ProcessId }
  try { $out.focused = [System.Windows.Automation.Automation]::Compare($e, [System.Windows.Automation.AutomationElement]::FocusedElement) } catch { $out.focused = $false }
  return $out
}
function Get-Around($e) {
  $c = $e.Current
  if ($c.IsPassword) { return @{ ok = $false; error = 'secure' } }
  $role = $c.ControlType.ProgrammaticName
  $tp = $null
  $vp = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
    $ranges = $tp.GetSelection()
    if (-not $ranges -or $ranges.Length -eq 0) { return @{ ok = $false; error = 'no-caret'; role = $role } }
    $startPoint = [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start
    $endPoint = [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End
    $char = [System.Windows.Automation.Text.TextUnit]::Character
    $pre = $ranges[0].Clone()
    $pre.MoveEndpointByRange($endPoint, $pre, $startPoint)
    $null = $pre.MoveEndpointByUnit($startPoint, $char, -4)
    $post = $ranges[0].Clone()
    $post.MoveEndpointByRange($startPoint, $post, $endPoint)
    $null = $post.MoveEndpointByUnit($endPoint, $char, 2)
    return @{ ok = $true; before = [string]$pre.GetText(8); after = [string]$post.GetText(4); role = $role; via = 'range' }
  }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
    # No caret to go by: only an empty box says what's around it (nothing).
    if ([string]::IsNullOrEmpty($vp.Current.Value)) { return @{ ok = $true; before = ''; after = ''; role = $role; via = 'empty' } }
    return @{ ok = $false; error = 'no-caret'; role = $role }
  }
  $h = Edit-Handle $c
  if ($h -eq [IntPtr]::Zero) { return @{ ok = $false; error = 'no-value'; role = $role } }
  if ([BabEditBox]::IsPassword($h)) { return @{ ok = $false; error = 'secure' } }
  # The caret's place is only exact below 65,536 characters (EM_GETSEL).
  $n = [BabEditBox]::Length($h)
  if ($n -lt 0 -or $n -gt 60000) { return @{ ok = $false; error = 'no-caret'; role = $role } }
  $text = [BabEditBox]::Text($h, $n)
  $range = [BabEditBox]::Selection($h)
  if ($text -eq $null -or $range -eq $null) { return @{ ok = $false; error = 'no-caret'; role = $role } }
  # A RichEdit box counts a line break as one character but writes it as two: its places would be off.
  if ($c.ClassName -match '^(RichEdit|RICHEDIT)' -and $text.Contains([string][char]13)) { return @{ ok = $false; error = 'no-caret'; role = $role } }
  $a = [Math]::Min($range[0], $text.Length)
  $b = [Math]::Min($range[0] + $range[1], $text.Length)
  $cut = [Math]::Max(0, $a - 4)
  return @{ ok = $true; before = $text.Substring($cut, $a - $cut); after = $text.Substring($b, [Math]::Min(2, $text.Length - $b)); role = $role; via = 'window' }
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
    elseif ($cmd -eq 'around') {
      $f = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($f -eq $null) { Send @{ ok = $false; error = 'no-focus' } }
      else { Send (Get-Around (Find-Text $f)) }
    }
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
    for (const k of ["before", "after"]) if (v[k] !== undefined && typeof v[k] !== "string") return { ok: false, error: "unreadable" };
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

  /**
   * What's right before and after the cursor in the focused box (or the selection, which typing
   * replaces): up to 4 characters before, 2 after, nothing else. For spacing (spacing.mjs).
   * @returns {Promise<{ ok: true, before: string, after: string } | { ok: false, error: string }>}
   */
  async around() {
    const r = await this.ask("around");
    if (!r?.ok) return { ok: false, error: String(r?.error ?? "failed") };
    return { ok: true, before: String(r.before ?? "").slice(-8), after: String(r.after ?? "").slice(0, 8) };
  }

  /** The helper answers (and, on a Mac, whether Accessibility is allowed). */
  ping() {
    return this.ask("ping");
  }

  /** @param {'focus'|'read'|'forget'|'ping'|'prime'|'around'} cmd */
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
