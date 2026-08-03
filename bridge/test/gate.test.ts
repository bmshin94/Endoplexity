import { test } from "node:test";
import assert from "node:assert/strict";
import { serialize } from "../../extension/ax.js";
import { check, remember } from "../src/gate.ts";
import { askPanel, setPanel, dropPanel, panelConnected, settle, settleGate } from "../src/relay.ts";
import { relay } from "../src/mcp.ts";

// Minimal stand-in for Accessibility.getFullAXTree nodes — same shape ax.test.ts
// uses, trimmed to the fields a role/name-only page needs. Real serialize()
// output is the point: if its line format ever drifts, this test breaks instead
// of the gate silently never matching a real page again.
const node = (nodeId: string, role: string, extra: { name?: string; backendDOMNodeId?: number; childIds?: string[] } = {}) => ({
  nodeId,
  ignored: false,
  role: { value: role },
  name: { value: extra.name ?? "" },
  ...(extra.backendDOMNodeId === undefined ? {} : { backendDOMNodeId: extra.backendDOMNodeId }),
  childIds: extra.childIds ?? [],
  properties: [],
});

// One irreversible action and one ordinary one on the same page, so a single
// remember() covers both branches of check().
const page = () => [
  node("1", "RootWebArea", { name: "Apply", childIds: ["2", "3"] }),
  node("2", "button", { name: "Submit Application", backendDOMNodeId: 11 }),
  node("3", "link", { name: "Read more", backendDOMNodeId: 12 }),
];

// Enough of a WebSocket for the relay — same fake relay.test.ts uses.
function fakePanel() {
  const sent: Record<string, unknown>[] = [];
  return { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)), sent };
}

test("gates a click whose label reads as irreversible", () => {
  const { text, refs } = serialize(page(), "f0");
  remember(text);
  const [submitRef] = refs.keys();
  assert.equal(check("click", { ref: submitRef }), `click ${submitRef} [button] "Submit Application"`);
  // Only click is gated — the same ref through any other tool is nobody's business.
  assert.equal(check("navigate", { ref: submitRef }), null);
});

test("lets an ordinary click through", () => {
  const { text, refs } = serialize(page(), "f0");
  remember(text);
  const [, linkRef] = refs.keys();
  assert.equal(check("click", { ref: linkRef }), null);
});

test("does not gate a ref that is not on the current page", () => {
  const { text } = serialize(page(), "f0");
  remember(text);
  // Stale or invented — the panel will reject it with "unknown/stale ref" on
  // its own, so there is nothing here worth blocking a human's time over.
  assert.equal(check("click", { ref: "@f0e999" }), null);
});

test("a 60s timeout denies without an answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const panel = fakePanel();
  setPanel(panel as never);

  const approved = askPanel('click @f0e38 [button] "Submit Application"');
  assert.equal(panel.sent.length, 1);
  assert.equal(panel.sent[0].type, "gate");

  t.mock.timers.tick(60_000);
  assert.equal(await approved, false);
  dropPanel(panel as never);
});

// The path that has to work. A broken settleGate looks exactly like a working
// one until you notice every approval sat for 60s and then denied itself.
test("an approved click is released to the panel", async () => {
  const { text, refs } = serialize(page(), "f0");
  remember(text);
  const [submitRef] = refs.keys();
  const panel = fakePanel();
  setPanel(panel as never);
  const flush = () => new Promise((r) => setImmediate(r));

  const result = relay("click", { ref: submitRef });
  await flush();
  const gate = panel.sent.find((m) => m.type === "gate");
  assert.ok(gate, "the click was relayed without ever asking");

  settleGate({ id: gate.id as number, approved: true });
  await flush();
  const call = panel.sent.find((m) => m.type === "tool");
  assert.ok(call, "approval did not release the click");

  settle({ id: call.id as number, ok: true, value: '@f0e1 [heading] "Thanks"' });
  assert.equal((await result).isError, undefined);
  dropPanel(panel as never);
});

test("a denied click returns an isError result telling the model not to retry", async () => {
  const { text, refs } = serialize(page(), "f0");
  remember(text);
  const [submitRef] = refs.keys();
  assert.equal(panelConnected(), false); // nothing connected — askPanel auto-denies

  const result = await relay("click", { ref: submitRef });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /do not retry/i);
});
