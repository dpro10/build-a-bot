/**
 * NVIDIA's speech runtime for Windows, ready to go inside the installer (electron-builder.yml ›
 * win.extraResources): NVIDIA's own release of NeMo-Speech.cpp, checked against the hash the app
 * pins (src/main/voice/local-speech.mjs › RUNTIMES), without what only building against it needs
 * (headers and link libraries). A signed build signs its program files with the app's certificate
 * (build/sign-the-rest.cjs): Windows' Smart App Control runs no unsigned program it doesn't know,
 * and NVIDIA's aren't signed. The app copies it from there instead of downloading it.
 *
 *   node scripts/bundle-speech-runtime.mjs [folder]    (build/speech-runtime by default)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE, RUNTIMES } from "../src/main/voice/local-speech.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "build", "speech-runtime"));
const runtime = RUNTIMES["win32-x64"];
const url = `${RELEASE}/${runtime.file}`;

const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const got = createHash("sha256").update(zip).digest("hex");
if (got !== runtime.sha256) throw new Error(`${runtime.file} isn't NVIDIA's release: SHA-256 ${got}, expected ${runtime.sha256}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bab-speech-runtime-"));
try {
  const file = path.join(tmp, runtime.file);
  fs.writeFileSync(file, zip);
  const unpacked = path.join(tmp, "unpacked");
  fs.mkdirSync(unpacked);
  // Windows' own tar (bsdtar) opens a .zip; elsewhere, unzip.
  if (process.platform === "win32") execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", file, "-C", unpacked]);
  else execFileSync("unzip", ["-q", file, "-d", unpacked]);
  const [root] = fs.readdirSync(unpacked);
  const from = path.join(unpacked, root);
  if (!fs.existsSync(path.join(from, "bin", "nemo-speech.exe"))) throw new Error(`no bin/nemo-speech.exe in ${runtime.file}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // The program and its DLLs, and its licenses and notices (Apache 2.0 asks for them to come along).
  for (const part of ["bin", "share"]) fs.cpSync(path.join(from, part), path.join(out, part), { recursive: true });
  fs.writeFileSync(
    path.join(out, "SOURCE.txt"),
    `NVIDIA NeMo-Speech.cpp for Windows, from ${url}\n(SHA-256 ${runtime.sha256}), without its headers and link libraries.\n` +
      `Signed builds of Build-a-bot sign its program files with Build-a-bot's certificate; they're otherwise NVIDIA's files, unchanged.\n` +
      `Licenses and notices: share/licenses/nemo-speech/.\n`,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const files = fs.readdirSync(path.join(out, "bin"));
console.log(`NVIDIA's runtime (${runtime.file}, checked) in ${out}: ${files.length} files in bin/ (${files.filter((f) => /\.(exe|dll)$/i.test(f)).join(", ")})`);
