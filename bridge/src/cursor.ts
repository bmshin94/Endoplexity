import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEFING_CORE } from "./claude.ts";

/**
 * A bridge-owned Cursor profile, deliberately not `~/.cursor`.
 *
 * Cursor resolves its config directory from `CURSOR_CONFIG_DIR` ahead of
 * `XDG_CONFIG_HOME` and `~/.cursor`, so pointing it here is this CLI's version of
 * claude's `--strict-mcp-config --setting-sources ""`. Both directions matter: the
 * operator's own MCP servers never load into an agent that is driving a
 * logged-in browser, and their real Cursor setup is left untouched.
 *
 * Outside the repo on purpose — `cursor-agent login` puts a real session in here.
 */
export const CONFIG_DIR = join(homedir(), ".comet-cursor");

/**
 * Isolation needs a second lever, and this one was measured rather than assumed.
 *
 * `CURSOR_CONFIG_DIR` covers `cli-config.json`, the session and the chat history —
 * but NOT `mcp.json`, which resolves off `homedir()`. Setting only the first and
 * calling it isolated is the trap: `mcp list` then reports the operator's own
 * servers and not comet, so the browser agent ends up with **more** reach than
 * the claude path and none of the tools it actually needs. Measured 2026-08-03:
 * 27 tools across 7 servers — a scraper with its own browser automation, a recon
 * tool, and stripe/supabase/vercel plugin auth — with comet absent.
 *
 * Pointing HOME at a directory the bridge owns puts `~/.cursor/mcp.json` inside
 * the sandbox, where the only server is comet.
 */
export const HOME_DIR = join(CONFIG_DIR, "home");

/**
 * Deny wins over allow in cursor's resolver, so the wildcards are the actual
 * boundary and the single allow entry is the hole the browser tools come back
 * through. `-p` is documented as having "access to all tools, including write and
 * shell", which is exactly the reach this removes.
 */
const PERMISSIONS = {
  allow: ["Mcp(comet:*)"],
  deny: ["Shell(*)", "Write(*)", "Read(*)", "WebFetch(*)"],
};

/** Mirrors the shim's own sort: 2026.7.9 is newer than 2026.10.1 without padding. */
const versionKey = (name: string) => {
  const [year, month, day] = name.split("-")[0].split(".");
  return Number(`${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`);
};

/**
 * The Windows installer ships shims — `cursor-agent.cmd` runs `cursor-agent.ps1`,
 * which picks the newest version directory and runs `node.exe index.js`. Node
 * cannot spawn a `.cmd` without `shell: true`, and a shell would put the user's
 * prompt back on a command line to be re-parsed, which is the injection surface
 * claude.ts avoids by resolving to a real executable. So skip the shims and run
 * the same node.exe they end at, repeating only their version pick.
 */
export function resolveCursor(): { command: string; leading: string[] } {
  const versions = join(process.env.LOCALAPPDATA ?? "", "cursor-agent", "versions");
  // Everywhere else the installer drops a real executable on PATH.
  if (process.platform !== "win32" || !existsSync(versions)) return { command: "cursor-agent", leading: [] };

  const newest = readdirSync(versions)
    .filter(
      (name) =>
        /^\d{4}\.\d{1,2}\.\d{1,2}/.test(name) &&
        existsSync(join(versions, name, "index.js")) &&
        existsSync(join(versions, name, "node.exe")),
    )
    .sort((a, b) => versionKey(b) - versionKey(a))[0];

  if (!newest) return { command: "cursor-agent", leading: [] };
  return { command: join(versions, newest, "node.exe"), leading: [join(versions, newest, "index.js")] };
}

/**
 * Seed the isolated profile. Returns the directory so startup can print it.
 *
 * `mcp.json` is overwritten whole — isolation is the entire point, and merging
 * would let another server back in. `cli-config.json` is merged, because
 * `cursor-agent login` writes the session into this same directory and clobbering
 * the file would log the bridge out on every restart.
 */
export function writeCursorConfig(port: number, token: string, dir: string = CONFIG_DIR): string {
  mkdirSync(dir, { recursive: true });

  // Under the sandboxed HOME, so it is the only mcp.json the agent can resolve.
  const mcpDir = join(dir, "home", ".cursor");
  mkdirSync(mcpDir, { recursive: true });
  writeFileSync(
    join(mcpDir, "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          comet: { type: "http", url: `http://127.0.0.1:${port}/mcp?token=${encodeURIComponent(token)}` },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  const configPath = join(dir, "cli-config.json");
  let existing = {};
  try {
    if (existsSync(configPath)) existing = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    // A corrupt config is not worth refusing to start over — the fields that
    // matter are all rewritten below anyway.
  }
  writeFileSync(
    configPath,
    JSON.stringify({ ...existing, version: 1, approvalMode: "allowlist", permissions: PERMISSIONS }, null, 2),
    { mode: 0o600 },
  );

  return dir;
}

// cursor-agent has no `--append-system-prompt`, so the briefing rides in front of
// the prompt instead. No ToolSearch line: that is a claude-side concept, and
// cursor hands MCP tools to the model directly.
const BRIEFING = BRIEFING_CORE;

/**
 * Spawn `cursor-agent -p` restricted to the browser tools.
 *
 * The restriction lives in `cli-config.json`, not in flags — this CLI has no
 * `--tools`/`--allowedTools`. Notably absent: `--force`/`--yolo`, which is
 * "run everything" and would undo the permission set entirely.
 *
 *  - `--approve-mcps` auto-approves the MCP servers in the config directory,
 *    which after `writeCursorConfig` is only comet. Without it the run stalls on
 *    an approval prompt no one is there to answer.
 *  - `--trust` accepts the workspace non-interactively. Same reason.
 */
export function runCursor(
  prompt: string,
  model: string,
  onEvent: (event: Record<string, unknown>) => void,
): ChildProcess {
  const { command, leading } = resolveCursor();
  const child = spawn(
    command,
    [
      ...leading,
      "-p",
      `${BRIEFING} ${prompt}`,
      "--output-format",
      "stream-json",
      "--model",
      model,
      "--approve-mcps",
      "--trust",
    ],
    {
      cwd: tmpdir(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // USERPROFILE is what homedir() reads on Windows, HOME everywhere else —
      // both, so the same sandbox holds on either platform.
      env: {
        ...process.env,
        CURSOR_CONFIG_DIR: CONFIG_DIR,
        USERPROFILE: HOME_DIR,
        HOME: HOME_DIR,
      },
    },
  );

  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line));
    } catch {
      onEvent({ type: "stray", text: line });
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("error", (err) =>
    onEvent({ type: "failed", error: `could not start cursor-agent: ${err.message}` }),
  );
  child.on("close", (code) =>
    onEvent({
      type: "done",
      code,
      ...(code === 0 ? {} : { error: stderr.trim() || `cursor-agent exited ${code}` }),
    }),
  );

  return child;
}
