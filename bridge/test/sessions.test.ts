import { test } from "node:test";
import assert from "node:assert/strict";
// The panel's session store, tested from the bridge's suite — same trick
// md.test.ts uses. sessions.js is DOM-free precisely so this works.
import { MAX_ENTRIES, MAX_FIELD, MAX_SESSIONS, fresh, pack, startNew, titleOf } from "../../extension/sessions.js";

const withEntries = (...entries: object[]) => ({ at: 1, entries });

test("a session is titled by the first thing the human typed, not the last", () => {
  const session = withEntries(
    { k: "note", text: "connected" },
    { k: "user", text: "compare the pricing tiers" },
    { k: "assistant", md: "# Tiers" },
    { k: "user", text: "now do it in a table" },
  );
  assert.equal(titleOf(session), "compare the pricing tiers");
});

test("a long title is clipped, and whitespace collapsed so it stays one line", () => {
  const title = titleOf(withEntries({ k: "user", text: `  a\n\nb  ${"x".repeat(200)}` }));
  assert.equal(title.length, 64);
  assert.ok(title.startsWith("a b x"));
  assert.ok(title.endsWith("…"));
});

test("an unstarted session is named for what it is, not called untitled", () => {
  assert.equal(titleOf(fresh()), "New session");
  assert.equal(titleOf(undefined as never), "New session");
  // Content but nothing typed — only reachable if a note lands before a task.
  assert.equal(titleOf(withEntries({ k: "note", text: "not connected" })), "Untitled task");
});

test("pack clips long strings — a stored page snapshot would blow the quota", () => {
  const [entry] = pack([{ k: "tool", name: "snapshot", extra: "line\n".repeat(5000) }]) as {
    extra: string;
    name: string;
  }[];
  assert.ok(entry.extra.length < MAX_FIELD + 60);
  assert.ok(entry.extra.endsWith("(truncated — the full text was in the run)"));
  // Short fields are untouched, and non-string fields survive as themselves.
  assert.equal(entry.name, "snapshot");
});

test("pack clips strings INSIDE a tool's args — the object slipped the clip entirely", () => {
  // A `type` call carrying a pasted cover letter went to storage whole, because
  // the clip only looked at string fields and `args` is an object. Twenty
  // sessions of those is how the 10MB quota gets hit while every field
  // individually looks capped.
  const [entry] = pack([
    { k: "tool", name: "type", args: { ref: "@f0e3", text: "x".repeat(5000) } },
  ]) as { args: { ref: string; text: string } }[];
  assert.ok(entry.args.text.length < MAX_FIELD + 60);
  // The shape survives — restore() reads args.ref off this.
  assert.equal(entry.args.ref, "@f0e3");
});

test("pack keeps the TAIL of a long run — the recent turns are the useful ones", () => {
  const entries = Array.from({ length: MAX_ENTRIES + 25 }, (_, i) => ({ k: "note", text: String(i) }));
  const packed = pack(entries) as { text: string }[];
  assert.equal(packed.length, MAX_ENTRIES);
  assert.equal(packed.at(-1)!.text, String(MAX_ENTRIES + 24));
  assert.equal(packed[0]!.text, "25");
});

test("pack does not mutate or alias the journal it was given", () => {
  const entries = [{ k: "user", text: "hi" }];
  const packed = pack(entries);
  assert.notEqual(packed[0], entries[0]);
  assert.deepEqual(entries, [{ k: "user", text: "hi" }]);
});

test("New pushes the live session into history and opens an empty one", () => {
  const before = [withEntries({ k: "user", text: "first task" })];
  const after = startNew(before, 99);
  assert.equal(after.length, 2);
  assert.deepEqual(after[0], { at: 99, entries: [] });
  assert.equal(titleOf(after[1]!), "first task");
});

test("New on an already-empty session is a no-op, not a second blank", () => {
  const sessions = [fresh(1), withEntries({ k: "user", text: "old" })];
  assert.equal(startNew(sessions, 99), sessions);
});

test("New from nothing at all still yields a live session", () => {
  assert.deepEqual(startNew([], 99), [{ at: 99, entries: [] }]);
  assert.deepEqual(startNew(undefined as never, 99), [{ at: 99, entries: [] }]);
});

test("the history is capped, and it is the oldest session that falls off", () => {
  let sessions = [fresh(0)];
  for (let i = 1; i <= MAX_SESSIONS + 5; i++) {
    sessions[0]!.entries.push({ k: "user", text: `task ${i}` } as never);
    sessions = startNew(sessions, i);
  }
  assert.equal(sessions.length, MAX_SESSIONS);
  // Newest first: the live blank, then the most recent finished session.
  assert.equal(titleOf(sessions[1]!), `task ${MAX_SESSIONS + 5}`);
  assert.ok(!sessions.some((s) => titleOf(s) === "task 1"));
});
