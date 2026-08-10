import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize, authorizeMcp, ALLOWED_ORIGIN } from "../src/auth.ts";

const TOKEN = "a".repeat(48);
const OTHER_EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

test("accepts the pinned extension origin", () => {
  assert.equal(authorize(ALLOWED_ORIGIN), true);
});

test("rejects a different extension's origin", () => {
  // The whole point of pinning: the old prefix check let this through, which is
  // also why a token was needed to back it up.
  assert.equal(authorize(OTHER_EXT), false);
  assert.equal(authorize("chrome-extension://"), false);
});

test("rejects a web page", () => {
  assert.equal(authorize("https://evil.example"), false);
  assert.equal(authorize("http://localhost:3000"), false);
  // A page cannot set Origin at all, but the near-miss is worth pinning: a
  // hostname that merely CONTAINS the id must not pass.
  assert.equal(authorize(`https://evil.example/${ALLOWED_ORIGIN}`), false);
});

test("rejects a missing origin", () => {
  // Which is also every CLI — those go to /mcp, gated by the token instead.
  assert.equal(authorize(undefined), false);
  assert.equal(authorize(""), false);
});

test("derived id is 32 lowercase a-p characters", () => {
  const id = ALLOWED_ORIGIN.replace("chrome-extension://", "");
  assert.equal(id.length, 32);
  assert.match(id, /^[a-p]{32}$/);
});

// /mcp is the inverse: only a CLI we spawned should reach it, and a CLI sends no
// Origin. Anything that does is a web page, whatever token it managed to present.
test("mcp accepts an origin-less request with the right token", () => {
  assert.equal(authorizeMcp(undefined, TOKEN, TOKEN), true);
});

test("mcp rejects anything carrying an Origin", () => {
  assert.equal(authorizeMcp("https://evil.example", TOKEN, TOKEN), false);
  assert.equal(authorizeMcp(ALLOWED_ORIGIN, TOKEN, TOKEN), false);
});

test("mcp rejects a missing or wrong token", () => {
  assert.equal(authorizeMcp(undefined, null, TOKEN), false);
  assert.equal(authorizeMcp(undefined, "", TOKEN), false);
  assert.equal(authorizeMcp(undefined, "b".repeat(48), TOKEN), false);
  assert.equal(authorizeMcp(undefined, TOKEN.slice(0, 47), TOKEN), false);
});
