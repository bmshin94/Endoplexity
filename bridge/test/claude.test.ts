import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { claudeArgs } from "../src/claude.ts";

// Spawn args are a security boundary — pin the ones that already bit us. These
// read the argv that actually reaches spawn rather than regexing the source
// that builds it: a misspelt flag is still perfectly valid source, and would
// disable the boundary while a source-text test kept passing.
const args = (resume?: string) => claudeArgs("do a thing", "sonnet", resume);
const valueOf = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

const src = readFileSync(fileURLToPath(new URL("../src/claude.ts", import.meta.url)), "utf8");

test("print mode auto-approves ToolSearch, not only mcp__comet__*", () => {
  assert.equal(valueOf(args(), "--allowedTools"), "ToolSearch,mcp__comet__*");
});

test("--allowedTools stays last — it is variadic and swallows whatever follows", () => {
  const argv = args("abc-123");
  assert.equal(argv.indexOf("--allowedTools"), argv.length - 2);
});

test("stdin is ignored so -p does not stall waiting for a pipe", () => {
  assert.match(src, /stdio:\s*\[\s*"ignore"/);
});

test("a fresh task carries no --resume", () => {
  assert.ok(!args().includes("--resume"));
});

test("a reply resumes exactly the session it was given", () => {
  const argv = args("abc-123");
  assert.equal(valueOf(argv, "--resume"), "abc-123");
  assert.equal(argv.filter((arg) => arg === "--resume").length, 1);
});

// The one that matters: --resume restores a conversation, not a permission set.
// A resumed run that lost these flags is a browser agent with a shell behind it.
test("resuming keeps the whole tool boundary", () => {
  const argv = args("abc-123");
  assert.equal(valueOf(argv, "--tools"), "ToolSearch");
  assert.equal(valueOf(argv, "--allowedTools"), "ToolSearch,mcp__comet__*");
  assert.equal(valueOf(argv, "--setting-sources"), "");
  assert.ok(argv.includes("--strict-mcp-config"));
});

test("--bare never reaches the spawn — it would force ANTHROPIC_API_KEY", () => {
  assert.ok(!args("abc-123").includes("--bare"));
});
