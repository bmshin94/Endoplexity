import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = fileURLToPath(new URL("../../.comet-mcp.json", import.meta.url));

/**
 * Habits real runs paid for, corrected up front. Each costs ~20 tokens here —
 * cached after the first turn — against a whole model turn each time it is not
 * said:
 *
 *  1. MCP tools arrive deferred, and the agent discovered them one at a time:
 *     four ToolSearch round trips for five tools. `select:` takes a list.
 *  2. It snapshotted after every action out of habit. The tools now hand the
 *     page back themselves, but the tool description alone did not stop it.
 *  3. It retried the same failing action three times before routing around it.
 *  4. Given "apply to THIS job" it asked which job and exited, having called
 *     nothing — it has no way to know a tab is open unless told. The panel now
 *     names the page in the prompt, and this says to act on it. Measured
 *     2026-08-06 on a Greenhouse posting: 1 turn, zero tool calls, $0.0064.
 *  5. Same run asked the user to "share your resume file". It cannot receive
 *     one, and the upload tool's own description says so — but that description
 *     only arrives after a ToolSearch this run never made.
 *
 * Deliberately generic — no site names. A prompt that knows about Google is a
 * prompt that is wrong on Greenhouse.
 */
export const BRIEFING_CORE = [
  "You drive a real web browser.",
  "The task names the page the user is already looking at — act on that page rather than asking which page they mean.",
  "navigate, click, key, upload and select return the page they produced — never call snapshot after them.",
  "Refs like @f1e7 are only valid on the most recent page you were given.",
  "You cannot be sent files: upload attaches one the user configured by key, so never ask for a file or a path.",
  "If an action did not do what you expected, take a different route rather than repeating it.",
].join(" ");

// Habit 1 is claude-only — cursor hands MCP tools to the model directly, with no
// deferred-tool step to get wrong.
const BRIEFING = [
  BRIEFING_CORE,
  "Load every browser tool in ONE ToolSearch call, query:",
  "select:mcp__comet__snapshot,mcp__comet__navigate,mcp__comet__click,mcp__comet__type,mcp__comet__key,mcp__comet__upload,mcp__comet__select",
].join(" ");

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
 * The flag set is a security boundary, not a preference — exported as a plain
 * array so a test can assert on it without spawning anything. Regexing the
 * source was the old check, and it passes just as happily on a typo'd flag as
 * on a correct one, which is the same trap cursor.test.ts already avoids by
 * asserting on the config it writes rather than the code that writes it.
 *
 * Each flag is load-bearing:
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
 *  - `--resume <id>` continues an existing transcript instead of starting one.
 *    Every other flag is still passed alongside it: resuming restores the
 *    conversation, NOT the tool restrictions, so a resumed run that dropped
 *    `--tools` would hand a browser agent a shell. Verified by running a
 *    resumed task and reading its init event, not by reading this comment.
 *
 * Deliberately NOT `--bare`, which also skips hooks but forces auth to
 * ANTHROPIC_API_KEY — the whole point here is to run on an existing subscription.
 */
export const claudeArgs = (prompt: string, model: string, resume?: string): string[] => [
  "-p",
  prompt,
  // Sonnet is the default the panel offers: browser driving is
  // snapshot-read-click, not hard reasoning, and the earlier Opus runs billed
  // ~20x for it. index.ts allowlists what may arrive here.
  "--model",
  model,
  // Before --allowedTools, which is variadic and swallows whatever follows it.
  ...(resume ? ["--resume", resume] : []),
  "--output-format",
  "stream-json",
  "--verbose", // stream-json refuses to run without it
  "--append-system-prompt",
  BRIEFING,
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
];

/**
 * Spawn `claude -p` with browser tools and nothing else. Pass `resume` to
 * continue a previous run's transcript rather than starting a fresh one.
 *
 * No `shell: true`: claude resolves to a real .exe, and a shell here would turn
 * a prompt containing quotes into a command-injection surface.
 */
export function runClaude(
  prompt: string,
  model: string,
  onEvent: (event: Record<string, unknown>) => void,
  resume?: string,
): ChildProcess {
  const child = spawn(
    "claude",
    claudeArgs(prompt, model, resume),
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
