/**
 * macOS: opened from Downloads or straight from the disk image, the app moves itself into
 * Applications and starts again from there. So installing is a double-click, and the app can
 * update itself later (macOS won't let it replace itself on a disk image or in a quarantined spot).
 */

/**
 * @param {{ platform: string, packaged: boolean, inApplications: boolean, env: Record<string, string | undefined> }} o
 */
export function shouldMoveToApplications({ platform, packaged, inApplications, env }) {
  if (platform !== "darwin" || !packaged || inApplications) return false;
  // Tests and checks run the app from wherever it was built.
  return env.BAB_STAY_PUT !== "1" && env.BAB_SMOKE !== "1" && env.BAB_TEST !== "1" && !env.BAB_USER_DATA;
}

/**
 * Moves the app if it should. Returns true when it moved: the app then quits and opens again from
 * Applications by itself.
 * @param {{ app: any, log: (m: string) => void, env?: Record<string, string | undefined>, platform?: string }} o
 */
export function moveToApplications({ app, log, env = process.env, platform = process.platform }) {
  let inApplications = true;
  try {
    inApplications = platform === "darwin" ? app.isInApplicationsFolder() : true;
  } catch {
    /* can't tell: leave it where it is */
  }
  if (!shouldMoveToApplications({ platform, packaged: app.isPackaged, inApplications, env })) return false;
  try {
    // An older copy that isn't running is replaced. If one is running, this one stays where it is.
    const moved = app.moveToApplicationsFolder({ conflictHandler: (kind) => kind === "exists" });
    if (moved) log("moved into Applications; starting again from there");
    return moved;
  } catch (err) {
    log(`couldn't move into Applications: ${/** @type {any} */ (err)?.message ?? err}`);
    return false;
  }
}
