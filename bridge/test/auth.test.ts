import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/auth.ts";

const TOKEN = "a".repeat(48);
const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

test("accepts an extension origin with the right token", () => {
  assert.equal(authorize(EXT, TOKEN, TOKEN), true);
});

test("rejects a web page even with the right token", () => {
  assert.equal(authorize("https://evil.example", TOKEN, TOKEN), false);
  assert.equal(authorize("http://localhost:3000", TOKEN, TOKEN), false);
});

test("rejects a missing or wrong token", () => {
  assert.equal(authorize(EXT, null, TOKEN), false);
  assert.equal(authorize(EXT, "", TOKEN), false);
  assert.equal(authorize(EXT, "b".repeat(48), TOKEN), false);
  assert.equal(authorize(EXT, TOKEN.slice(0, 47), TOKEN), false);
});

test("rejects a missing origin", () => {
  assert.equal(authorize(undefined, TOKEN, TOKEN), false);
});
