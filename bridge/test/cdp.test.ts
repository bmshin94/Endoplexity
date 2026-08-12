import { test } from "node:test";
import assert from "node:assert/strict";

// cdp.js is the one extension module that is NOT DOM-free, so unlike ax/md/
// sessions it cannot just be imported: it registers chrome.debugger listeners at
// import time and throws on load without them. Hence the stub below, installed
// ONCE before a dynamic import — a top-level `import` would hoist above the stub,
// and a second stub would never be wired up, because the listeners are only
// registered on the first import.
//
// Scope: dead-OOPIF reaping, and which caller is allowed to OPEN a tab.
// Everything else in cdp.js is verified live by `endo.selftest()`, which drives
// a real Chrome; a stub deep enough to test clicking would only be testing the
// stub.

type Handler = (source: { tabId: number }, method: string, params: unknown) => void;

const DEAD = "Session with given id not found.";

/** Set per test: which (session, method) pairs blow up, and with what. */
let fail: (sessionId: string, method: string) => string | null = () => null;
/** Every sendCommand, so a reaped session can be shown to cost nothing later. */
const calls: { sessionId: string; method: string }[] = [];
let onEvent: Handler = () => {};
/** Set per test: what the window has open, and whether anyone opened a tab. */
let openTabs = [{ id: 1, url: "https://example.test/", active: true }];
let created = 0;

(globalThis as unknown as { chrome: unknown }).chrome = {
  debugger: {
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (target: { sessionId?: string }, method: string) => {
      const sessionId = target.sessionId ?? "";
      calls.push({ sessionId, method });
      const message = fail(sessionId, method);
      if (message) throw new Error(message);
      return method === "Accessibility.getFullAXTree" ? { nodes: [] } : {};
    },
    onEvent: { addListener: (fn: Handler) => (onEvent = fn) },
    onDetach: { addListener: () => {} },
  },
  tabs: {
    get: async () => ({ id: 1, url: "https://example.test/", title: "t" }),
    query: async () => openTabs,
    create: async () => ({ id: (created++, 2) }),
    onUpdated: { addListener: () => {}, removeListener: () => {} },
  },
};

const cdp = await import("../../extension/cdp.js");

const attachFrame = (sessionId: string) =>
  onEvent({ tabId: 1 }, "Target.attachedToTarget", {
    sessionId,
    targetInfo: { type: "iframe", url: "https://frame.test/" },
  });

test("a frame whose session is gone is dropped, and never costs a round trip again", async () => {
  fail = (sessionId) => (sessionId === "s1" ? DEAD : null);
  await cdp.attach(1);
  attachFrame("s1");
  assert.equal(cdp.state().frames.length, 2, "main + the attached frame");

  const first = await cdp.snapshot();
  assert.ok(!first.includes("unavailable"), `a gone frame should not narrate itself: ${first}`);
  assert.equal(cdp.state().frames.length, 1, "the dead frame is reaped on the failure that revealed it");

  calls.length = 0;
  await cdp.snapshot();
  assert.equal(
    calls.filter((call) => call.sessionId === "s1").length,
    0,
    "a reaped frame must not be spoken to again — that failed round trip per snapshot is the whole cost being removed",
  );

  await cdp.detach();
});

test("a live frame having a bad moment is kept, and still says so", async () => {
  fail = (sessionId, method) =>
    sessionId === "s1" && method === "Accessibility.getFullAXTree" ? "Accessibility agent is not enabled" : null;
  await cdp.attach(1);
  attachFrame("s1");

  const text = await cdp.snapshot();
  assert.match(text, /unavailable/, "a recoverable error still belongs in the page");
  assert.equal(cdp.state().frames.length, 2, "forgetting a live frame would lose it for the rest of the run");

  await cdp.detach();
});

test("with nothing drivable open, only the caller that will USE a tab opens one", async () => {
  fail = () => null;
  // A fresh window: one chrome://newtab, which takes neither debugger nor navigation.
  openTabs = [{ id: 1, url: "chrome://newtab/", active: true }];
  created = 0;

  // The panel's pre-Run re-attach. Opening an active blank tab here is what
  // dropped the user on a black page under a debugger banner for the whole
  // first turn, before the model had asked to go anywhere.
  assert.equal(await cdp.attach(undefined, { open: false }), null, "nothing to drive, so nothing attached");
  assert.equal(created, 0, "the re-attach must not create a tab");
  assert.equal(await cdp.currentPage(), null, "and the prompt names no page, because there is none");

  // The first tool call still gets one — that is where a tab is actually needed,
  // and navigate() puts a real page on it immediately.
  assert.equal(await cdp.attach(), 2, "the tool layer opens the tab it is about to drive");
  assert.equal(created, 1);

  await cdp.detach();
});
