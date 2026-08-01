import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Spawn args are a security boundary — pin the ones that already bit us.
const src = readFileSync(fileURLToPath(new URL("../src/claude.ts", import.meta.url)), "utf8");

test("print mode auto-approves ToolSearch, not only mcp__comet__*", () => {
  assert.match(src, /--allowedTools[\s\S]*?ToolSearch,mcp__comet__\*/);
});

test("stdin is ignored so -p does not stall waiting for a pipe", () => {
  assert.match(src, /stdio:\s*\[\s*"ignore"/);
});
