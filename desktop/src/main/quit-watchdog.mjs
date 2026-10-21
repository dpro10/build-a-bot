/**
 * Quitting always quits, even when the app gets stuck in native code on the way out (seen on
 * Windows, where the app's own timers can't run then): a tiny watchdog outside the app ends it if
 * it's still there after a while. The watchdog holds on to the app's process while it waits, so
 * Windows can't hand that process id to another program in the meantime, and it goes away the
 * moment the app does.
 */
import { spawn } from "node:child_process";
import path from "node:path";

/** The PowerShell the watchdog runs (encoded for -EncodedCommand). */
export function watchdogScript(/** @type {number} */ pid, /** @type {string} */ name, /** @type {number} */ ms) {
  return [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    `if ($p -and $p.ProcessName -eq '${name}' -and -not $p.WaitForExit(${ms})) { taskkill.exe /F /T /PID ${pid} | Out-Null }`,
  ].join("\n");
}

/**
 * @param {{ ms: number, pid?: number, exe?: string, platform?: string, spawnImpl?: typeof spawn, log?: (msg: string) => void }} o
 * @returns {import('node:child_process').ChildProcess | null}
 */
export function startQuitWatchdog(o) {
  const platform = o.platform ?? process.platform;
  if (platform !== "win32") return null;
  const pid = o.pid ?? process.pid;
  const name = path.win32.basename(o.exe ?? process.execPath).replace(/\.exe$/i, "");
  // A program's name is letters, digits and a few marks: nothing that could break out of the script.
  if (!Number.isInteger(pid) || pid <= 0 || !/^[\w .()-]+$/.test(name)) return null;
  const encoded = Buffer.from(watchdogScript(pid, name, Math.round(o.ms)), "utf16le").toString("base64");
  try {
    const child = (o.spawnImpl ?? spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on?.("error", (err) => o.log?.(`shutdown: the watchdog didn't start (${/** @type {any} */ (err)?.code ?? err})`));
    child.unref?.();
    return child;
  } catch (err) {
    o.log?.(`shutdown: the watchdog didn't start (${/** @type {any} */ (err)?.code ?? err})`);
    return null;
  }
}
