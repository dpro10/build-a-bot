import { execFileSync } from "node:child_process";

/**
 * Quitting the app at the end of an e2e. It has to be gone within a minute (the app gives up on a
 * stuck shutdown after 30 s, and on Windows a watchdog ends it after 40 s); when it took a while,
 * the app log says why.
 * @param {import('playwright').ElectronApplication | null} app
 * @param {() => string} appLog
 */
export async function quitApp(app, appLog = () => "") {
  if (!app) return;
  const t0 = Date.now();
  let timer;
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => (timer = setTimeout(() => r(false), 60_000)))]);
  // A timer left running would hold the test file open for the rest of the minute.
  clearTimeout(timer);
  const took = Date.now() - t0;
  if (!closed || took > 10_000) {
    console.log(`--- quitting took ${(took / 1000).toFixed(1)} s; app log (last 60 lines) ---\n${appLog().split("\n").slice(-60).join("\n")}`);
  }
  if (!closed) {
    killTree(app.process());
    throw new Error("The app didn't quit within 60 s of being asked.");
  }
}

/** The app and the processes it started (left behind, they'd keep the test file open). */
function killTree(/** @type {import('node:child_process').ChildProcess | undefined} */ child) {
  const pid = child?.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", timeout: 15_000 });
    else child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}
