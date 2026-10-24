/**
 * electron-builder's afterSign, for the Windows app: signs every program file it left unsigned.
 *
 * electron-builder signs the app's .exe files. Windows' Smart App Control also checks every DLL
 * and native module as it's loaded, and blocks unsigned ones Microsoft doesn't know: NVIDIA's
 * speech runtime (nemo-speech.exe's DLLs), the keyboard hook (uiohook-napi.node) and some of
 * Electron's own DLLs. Those are signed here, with the same Azure Artifact Signing account and
 * module electron-builder uses (its windowsSignAzureManager). Files already signed (by Microsoft,
 * or by electron-builder just before) are left as they are. They're signed only in a signed build
 * (CI on main, with the signing settings: desktop/README.md › Packaging and signing); an unsigned
 * one just lists them.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** Windows program files: .exe, .dll and .node files built for Windows (they start with "MZ"). */
function programFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...programFiles(file));
    else if (/\.(exe|dll|node)$/i.test(entry.name) && startsWithMz(file)) out.push(file);
  }
  return out;
}

function startsWithMz(file) {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(2);
    return fs.readSync(fd, b, 0, 2, 0) === 2 && b.toString("latin1") === "MZ";
  } finally {
    fs.closeSync(fd);
  }
}

/** PowerShell 7 where it's installed (as electron-builder prefers), else Windows PowerShell. */
function powershell() {
  try {
    execFileSync("pwsh.exe", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
    return "pwsh.exe";
  } catch {
    return "powershell.exe";
  }
}

exports.default = async function signTheRest(context) {
  if (context.electronPlatformName !== "win32") return;
  const azure = context.packager.platformSpecificBuildOptions.azureSignOptions;
  // Signatures are read and made with Windows' own tools.
  if (process.platform !== "win32") return console.log("  • not built on Windows: the rest of its program files aren't signed");
  const ps = powershell();
  const run = (script, env, stdio = "inherit") =>
    execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${script}`], { env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", stdio, "inherit"] });

  // The paths go in an environment variable, so nothing in them needs quoting.
  const unsigned = run(
    `$env:BAB_FILES -split "\`n" | Where-Object { $_ -and (Get-AuthenticodeSignature -LiteralPath $_).Status -eq 'NotSigned' }`,
    { BAB_FILES: programFiles(context.appOutDir).join("\n") },
    "pipe",
  )
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const names = unsigned.map((f) => path.relative(context.appOutDir, f)).join(", ");
  if (!azure) {
    console.log(`  • unsigned build: ${unsigned.length} program files a signed one also signs${unsigned.length ? `: ${names}` : ""}`);
    return;
  }
  if (!unsigned.length) return;
  console.log(`  • signing ${unsigned.length} more program files: ${names}`);
  run(
    "if (-not (Get-Module -ListAvailable -Name TrustedSigning)) { Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force -Repository PSGallery -Scope CurrentUser }; " +
      "Invoke-TrustedSigning -Endpoint $env:BAB_ENDPOINT -CodeSigningAccountName $env:BAB_ACCOUNT -CertificateProfileName $env:BAB_PROFILE " +
      "-FileDigest SHA256 -TimestampRfc3161 'http://timestamp.acs.microsoft.com' -TimestampDigest SHA256 -Files $env:BAB_SIGN",
    {
      BAB_ENDPOINT: azure.endpoint,
      BAB_ACCOUNT: azure.codeSigningAccountName,
      BAB_PROFILE: azure.certificateProfileName,
      // Its -Files takes a comma-separated list (none of these paths has a comma).
      BAB_SIGN: unsigned.join(","),
    },
  );
};
