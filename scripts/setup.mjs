// ponytail: Windows-only autostart via a Startup-folder .vbs launcher — no
// service manager to install, upgrade, or uninstall. Non-Windows: run
// `npm start` by hand.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("autostart is Windows-only for now; run `npm start` yourself.");
  process.exit(0);
}

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bridgeIndex = path.join(repoRoot, "bridge", "src", "index.ts");
const logPath = path.join(repoRoot, ".comet-bridge.log");
const vbs = `CreateObject("WScript.Shell").Run "cmd /c node ""${bridgeIndex}"" >> ""${logPath}"" 2>&1", 0, False\r\n`;

const startupDir = path.join(
  process.env.APPDATA ?? "",
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
);
const autostart = existsSync(startupDir);
const vbsPath = path.join(autostart ? startupDir : repoRoot, "CometClone.vbs");
writeFileSync(vbsPath, vbs);

console.log(`launcher written: ${vbsPath} (re-run this script anytime — it overwrites the .vbs)`);
if (!autostart) {
  console.log("no Startup folder found — autostart unavailable. Double-click CometClone.vbs in the repo root to start the bridge by hand.");
}
console.log(`bridge log: ${logPath}`);
// ponytail: a `git pull` doesn't restart the bridge — the old process keeps
// running on the old code until you kill it and relaunch the .vbs.

try {
  // Another chunk is adding this export to auth.ts right now — skip the line,
  // don't fail setup, if it isn't there yet.
  const { ALLOWED_ORIGIN } = await import("../bridge/src/auth.ts");
  if (ALLOWED_ORIGIN) console.log(`expected extension origin: ${ALLOWED_ORIGIN}`);
} catch {}

console.log("next: load extension/ unpacked at chrome://extensions, then open the side panel.");
