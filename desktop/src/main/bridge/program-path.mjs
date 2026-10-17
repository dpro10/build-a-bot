/**
 * Where the owner's programs are, so the Bridge finds Claude Code and Codex the way their terminal
 * does. An app opened from the Finder (or at login) gets launchd's bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin): `claude` in /opt/homebrew/bin, ~/.local/bin or an nvm folder
 * wouldn't be found. So the login shell is asked for its PATH once (with a timeout), and the usual
 * install folders are added. On Windows the PATH is read again from the registry, so a CLI
 * installed after the app started is found without restarting it.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const MARK = "__BAB_PATH__";

/** The PATH between the markers in a shell's output (anything a profile prints is ignored). @param {string} out */
export function parseShellPath(out) {
  const i = out.indexOf(MARK);
  const j = i < 0 ? -1 : out.indexOf(MARK, i + MARK.length);
  if (j < 0) return null;
  return out.slice(i + MARK.length, j).trim() || null;
}

/**
 * @param {(file: string, args: string[], opts: object, cb: (err: Error | null, stdout: string) => void) => void} run
 * @param {string} file @param {string[]} args @param {object} opts
 * @returns {Promise<string>}
 */
function exec(run, file, args, opts) {
  return new Promise((resolve) => {
    try {
      run(file, args, opts, (err, stdout) => resolve(err && !stdout ? "" : String(stdout ?? "")));
    } catch {
      resolve("");
    }
  });
}

/**
 * The login shell's PATH (macOS, Linux), or null.
 * @param {{ env: Record<string, string | undefined>, platform: NodeJS.Platform, run?: typeof execFile, timeoutMs?: number }} o
 */
export async function loginShellPath(o) {
  const shell = o.env.SHELL || (o.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const fish = path.basename(shell) === "fish";
  const script = fish ? `printf '%s' ${MARK}(string join : $PATH)${MARK}` : `printf '%s' "${MARK}$PATH${MARK}"`;
  const out = await exec(o.run ?? execFile, shell, ["-ilc", script], {
    // Keep profiles from waiting on a question or starting tmux.
    env: { ...o.env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false", ZSH_TMUX_AUTOSTARTED: "true" },
    timeout: o.timeoutMs ?? 5000,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    encoding: "utf8",
  });
  return parseShellPath(out);
}

/**
 * The user's and the system's PATH from the registry (Windows), with %VARIABLES% filled in, or null.
 * @param {{ env: Record<string, string | undefined>, run?: typeof execFile }} o
 */
export async function registryPath(o) {
  const run = o.run ?? execFile;
  const query = async (key) => {
    const out = await exec(run, "reg.exe", ["query", key, "/v", "Path"], { timeout: 5000, windowsHide: true, encoding: "utf8" });
    const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out);
    return m ? m[1].trim() : "";
  };
  const [machine, user] = await Promise.all([query("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), query("HKCU\\Environment")]);
  const joined = [machine, user].filter(Boolean).join(";");
  if (!joined) return null;
  const lookup = (name) => {
    const k = Object.keys(o.env).find((key) => key.toUpperCase() === name.toUpperCase());
    return k ? o.env[k] : undefined;
  };
  return joined.replace(/%([^%;]+)%/g, (all, name) => lookup(name) ?? all);
}

/**
 * Folders CLIs are often installed in, newest installers first.
 * @param {string} home @param {NodeJS.Platform} platform @param {Record<string, string | undefined>} env
 */
export function installDirs(home, platform, env) {
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.win32.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return [path.win32.join(home, ".local", "bin"), path.win32.join(appData, "npm"), path.win32.join(local, "pnpm"), path.win32.join(home, ".bun", "bin"), path.win32.join(local, "Volta", "bin")];
  }
  const dirs = [
    path.posix.join(home, ".local", "bin"),
    path.posix.join(home, ".claude", "local"),
    path.posix.join(home, ".npm-global", "bin"),
    path.posix.join(home, ".bun", "bin"),
    path.posix.join(home, ".volta", "bin"),
    platform === "darwin" ? path.posix.join(home, "Library", "pnpm") : path.posix.join(home, ".local", "share", "pnpm"),
  ];
  if (platform === "darwin") dirs.push("/opt/homebrew/bin");
  dirs.push("/usr/local/bin");
  return dirs;
}

/** Join PATH parts, first one wins, no repeats. @param {Array<string | null | undefined>} parts @param {NodeJS.Platform} platform */
export function mergePath(parts, platform) {
  const sep = platform === "win32" ? ";" : ":";
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    for (const dir of String(part ?? "").split(sep)) {
      const d = dir.trim();
      const key = platform === "win32" ? d.toLowerCase() : d;
      if (!d || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out.join(sep);
}

/**
 * The PATH to find and run Claude Code and Codex with.
 * @param {{ env?: Record<string, string | undefined>, platform?: NodeJS.Platform, home?: string, run?: typeof execFile }} [o]
 */
export async function programPath(o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const home = o.home ?? os.homedir();
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const fresh = platform === "win32" ? await registryPath({ env, run: o.run }) : await loginShellPath({ env, platform, run: o.run });
  return mergePath([fresh, env[key], installDirs(home, platform, env).join(platform === "win32" ? ";" : ":")], platform);
}
