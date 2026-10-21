/**
 * A tiny logger. Device tokens are scrubbed from anything it writes, as a backstop:
 * nothing should ever try to log one. No analytics: logs stay on this computer.
 */
import fs from "node:fs";
import path from "node:path";

const TOKEN = /bab_dev_[A-Za-z0-9_-]+/g;

export function redact(text) {
  return String(text).replace(TOKEN, "bab_dev_[hidden]").replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"',}]+/gi, "$1[hidden]");
}

/**
 * Each line is on disk when `log` returns (written straight to the file, not buffered), so the
 * last thing the app did before a crash or a hang is in the log.
 * @param {{ file?: string | null, echo?: boolean }} [opts]
 */
export function createLogger(opts = {}) {
  let fd = null;
  if (opts.file) {
    try {
      fs.mkdirSync(path.dirname(opts.file), { recursive: true, mode: 0o700 });
      // Keep the log small: start over when it gets big.
      try {
        if (fs.statSync(opts.file).size > 2 * 1024 * 1024) fs.rmSync(opts.file);
      } catch {
        /* no log yet */
      }
      fd = fs.openSync(opts.file, "a", 0o600);
    } catch {
      fd = null;
    }
  }
  return function log(msg, extra) {
    const line = redact(`[${new Date().toISOString()}] ${msg}${extra !== undefined ? ` ${safeJson(extra)}` : ""}`);
    if (opts.echo !== false) console.log(line);
    if (fd === null) return;
    try {
      fs.writeSync(fd, `${line}\n`);
    } catch {
      /* a full disk mustn't stop the app */
    }
  };
}

function safeJson(v) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
