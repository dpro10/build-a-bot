/**
 * Packs the Bridge (bridge/) into public/downloads, so the site itself serves it and owners run
 *   npx -y {APP_URL}/downloads/build-a-bot-bridge-<version>.tgz pair ABCD-1234
 * with nothing published to npm. Runs before every build (npm's "prebuild").
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "public", "downloads");
fs.mkdirSync(out, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const output = execFileSync(npm, ["pack", "./bridge", "--pack-destination", out, "--silent"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
console.log(`Bridge packed: public/downloads/${output.trim().split("\n").pop()}`);
