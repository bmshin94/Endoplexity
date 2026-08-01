import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize, authorizeMcp } from "../src/auth.ts";

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

// /mcp is the inverse: only a CLI we spawned should reach it, and a CLI sends no
// Origin. Anything that does is a web page, whatever token it managed to present.
test("mcp accepts an origin-less request with the right token", () => {
  assert.equal(authorizeMcp(undefined, TOKEN, TOKEN), true);
});

test("mcp rejects anything carrying an Origin", () => {
  assert.equal(authorizeMcp("https://evil.example", TOKEN, TOKEN), false);
  assert.equal(authorizeMcp(EXT, TOKEN, TOKEN), false);
});

test("mcp rejects a missing or wrong token", () => {
  assert.equal(authorizeMcp(undefined, null, TOKEN), false);
  assert.equal(authorizeMcp(undefined, "", TOKEN), false);
  assert.equal(authorizeMcp(undefined, "b".repeat(48), TOKEN), false);
  assert.equal(authorizeMcp(undefined, TOKEN.slice(0, 47), TOKEN), false);
});
