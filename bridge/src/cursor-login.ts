import { spawn } from "node:child_process";
import { CONFIG_DIR, HOME_DIR, resolveCursor } from "./cursor.ts";

/**
 * `npm run cursor-login` — logs in to the bridge's own Cursor profile.
 *
 * This exists so the profile path is never typed by hand. The agent only reads
 * credentials from the directory `CURSOR_CONFIG_DIR` points at, so a login run
 * against the default `~/.cursor` leaves the bridge still logged out, with
 * nothing on screen explaining why. Importing CONFIG_DIR from the adapter is the
 * whole point: the login and the spawn cannot drift apart.
 *
 * stdio is inherited — this one is interactive on purpose, unlike every other
 * spawn here. It prints a URL and waits for the browser round trip.
 */
const { command, leading } = resolveCursor();

console.log(`logging in to ${CONFIG_DIR}`);
spawn(command, [...leading, "login"], {
  stdio: "inherit",
  // Same sandbox the agent runs under, so login can never populate one profile
  // while the agent reads another.
  env: { ...process.env, CURSOR_CONFIG_DIR: CONFIG_DIR, USERPROFILE: HOME_DIR, HOME: HOME_DIR },
}).on("close", (code) => {
  console.log(code === 0 ? "logged in — the Cursor models are now selectable in the panel" : `login exited ${code}`);
  process.exitCode = code ?? 1;
});
