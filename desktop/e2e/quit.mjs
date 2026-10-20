/**
 * Quitting the app at the end of an e2e. It has to be gone within a minute (the app itself gives
 * up on a stuck shutdown after 40 s); when it took a while, the app log says why.
 * @param {import('playwright').ElectronApplication | null} app
 * @param {() => string} appLog
 */
export async function quitApp(app, appLog = () => "") {
  if (!app) return;
  const t0 = Date.now();
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 60_000))]);
  const took = Date.now() - t0;
  if (!closed || took > 10_000) {
    console.log(`--- quitting took ${(took / 1000).toFixed(1)} s; app log (last 60 lines) ---\n${appLog().split("\n").slice(-60).join("\n")}`);
  }
  if (!closed) {
    try {
      app.process().kill();
    } catch {
      /* already gone */
    }
    throw new Error("The app didn't quit within 60 s of being asked.");
  }
}
