// ponytail: Windows-only autostart via a Startup-folder .vbs launcher — no
// service manager to install, upgrade, or uninstall. Non-Windows: run
// `npm start` by hand.
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("autostart is Windows-only for now; run `npm start` yourself.");
  process.exit(0);
}

// Checked BEFORE the launcher is written. The bridge runs TypeScript with no
// build step, so on old node it dies at startup — invisibly, from a .vbs, into
// a log nobody has been told about yet. Setup is the one moment this is cheap
// to catch, and a written launcher makes a broken install look like a done one.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error(`node ${process.versions.node} is too old — the bridge runs .ts directly and needs node 24+.`);
  process.exit(1);
}

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bridgeIndex = path.join(repoRoot, "bridge", "src", "index.ts");
const logPath = path.join(repoRoot, ".endo-bridge.log");
const vbs = `CreateObject("WScript.Shell").Run "cmd /c node ""${bridgeIndex}"" >> ""${logPath}"" 2>&1", 0, False\r\n`;

const startupDir = path.join(
  process.env.APPDATA ?? "",
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
);
const autostart = existsSync(startupDir);
const vbsPath = path.join(autostart ? startupDir : repoRoot, "Endoplexity.vbs");
writeFileSync(vbsPath, vbs);

console.log(`launcher written: ${vbsPath} (re-run this script anytime — it overwrites the .vbs)`);
if (!autostart) {
  console.log("no Startup folder found — autostart unavailable. Double-click Endoplexity.vbs in the repo root to start the bridge by hand.");
}
console.log(`bridge log: ${logPath}`);
// ponytail: a `git pull` doesn't restart the bridge — the old process keeps
// running on the old code until you kill it and relaunch the .vbs.

try {
  // Printed so a refused upgrade is diagnosable: the bridge logs the origin it
  // rejected, and this is the one it wanted. Never fatal — the launcher is
  // already written by this point and setup has done its job.
  const { ALLOWED_ORIGIN } = await import("../bridge/src/auth.ts");
  if (ALLOWED_ORIGIN) console.log(`expected extension origin: ${ALLOWED_ORIGIN}`);
} catch {}

// `where`, not a spawn of the CLI itself: both ship as .cmd shims on Windows,
// which spawnSync cannot run without a shell. A warning rather than a failure —
// you only need whichever one you actually intend to drive.
const onPath = (cmd) => spawnSync("where", [cmd], { windowsHide: true }).status === 0;
const found = ["claude", "cursor-agent"].filter(onPath);
if (found.length) console.log(`agent CLIs on PATH: ${found.join(", ")}`);
else console.warn("neither `claude` nor `cursor-agent` is on PATH — install one, or every task fails with ENOENT.");

console.log("next: load extension/ unpacked at chrome://extensions, then open the side panel.");
