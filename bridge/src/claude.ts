import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = fileURLToPath(new URL("../../.comet-mcp.json", import.meta.url));

/**
 * The token cannot be passed on the command line — argv shows up in any process
 * listing on the machine. It goes in a 0600 file instead, which is also the only
 * form `--mcp-config` needs.
 */
export function writeMcpConfig(port: number, token: string): string {
  const config = {
    mcpServers: {
      comet: { type: "http", url: `http://127.0.0.1:${port}/mcp?token=${encodeURIComponent(token)}` },
    },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  return CONFIG_PATH;
}

/**
 * Spawn `claude -p` with browser tools and nothing else.
 *
 * The flag set is a security boundary, not a preference. Each one is load-bearing:
 *
 *  - `--tools "ToolSearch"` cuts the built-in set down to one schema-lookup tool.
 *    The design doc called for a denylist (`--disallowedTools Bash Edit Write
 *    Read`); that was written POSIX-first and measurably failed — a spawned
 *    agent still reported PowerShell, Task, Skill, WebFetch and NotebookEdit in
 *    its init event, so "fill in this form" had a shell behind it after all. An
 *    allowlist cannot rot as new tools ship.
 *    ToolSearch has to stay: MCP tools arrive deferred, and it is the only way
 *    to reach them. Measured — with `--tools ""` the agent never sees a single
 *    comet tool. It only fetches schemas, so it grants no new reach itself.
 *  - `--allowedTools "ToolSearch,mcp__comet__*"` auto-approves both. Print mode
 *    with only `mcp__comet__*` leaves ToolSearch visible but uncallable — the
 *    model then pastes fake `<function_calls>` XML as text and exits in one
 *    turn. Measured 2026-08-01 against claude 2.1.170.
 *  - `--strict-mcp-config` keeps the operator's own MCP servers out of reach.
 *  - `--setting-sources ""` loads no user/project settings, so local hooks and
 *    CLAUDE.md do not end up as context in a browser agent. Worth real money:
 *    with them loaded a one-tool task billed 33k tokens of unrelated preamble.
 *
 * Deliberately NOT `--bare`, which also skips hooks but forces auth to
 * ANTHROPIC_API_KEY — the whole point here is to run on an existing subscription.
 *
 * No `shell: true`: claude resolves to a real .exe, and a shell here would turn
 * a prompt containing quotes into a command-injection surface.
 */
export function runClaude(prompt: string, onEvent: (event: Record<string, unknown>) => void): ChildProcess {
  const child = spawn(
    "claude",
    [
      "-p",
      prompt,
      // Sonnet by default: browser driving is snapshot-read-click, not hard
      // reasoning, and the earlier Opus runs billed ~20x for it. P5 adds the picker.
      "--model",
      "sonnet",
      "--output-format",
      "stream-json",
      "--verbose", // stream-json refuses to run without it
      "--mcp-config",
      CONFIG_PATH,
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--tools",
      "ToolSearch",
      // Variadic, so it stays last or it swallows whatever follows.
      "--allowedTools",
      "ToolSearch,mcp__comet__*",
    ],
    // Somewhere with no CLAUDE.md, belt to --setting-sources' braces.
    // stdin ignored: -p otherwise waits 3s for piped input that never comes.
    { cwd: tmpdir(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  // readline does the line framing — NDJSON arrives split across chunks.
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
    onEvent({ type: "failed", error: `could not start claude: ${err.message}` }),
  );
  child.on("close", (code) =>
    onEvent({ type: "done", code, ...(code === 0 ? {} : { error: stderr.trim() || `claude exited ${code}` }) }),
  );

  return child;
}
