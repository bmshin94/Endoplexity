import { test } from "node:test";
import assert from "node:assert/strict";
import { serialize } from "../../extension/ax.js";

// Minimal stand-ins for Accessibility.getFullAXTree nodes — only the fields the
// serializer reads.
const node = (
  nodeId: string,
  role: string,
  extra: {
    name?: string;
    value?: unknown;
    backendDOMNodeId?: number;
    childIds?: string[];
    ignored?: boolean;
    props?: Record<string, unknown>;
  } = {},
) => ({
  nodeId,
  ignored: extra.ignored ?? false,
  role: { value: role },
  name: { value: extra.name ?? "" },
  ...(extra.value === undefined ? {} : { value: { value: extra.value } }),
  ...(extra.backendDOMNodeId === undefined ? {} : { backendDOMNodeId: extra.backendDOMNodeId }),
  childIds: extra.childIds ?? [],
  properties: Object.entries(extra.props ?? {}).map(([name, v]) => ({ name, value: { value: v } })),
});

// A Greenhouse-shaped form: heading, two fields, a submit button buried under an
// ignored wrapper, and an unchecked checkbox.
const form = () => [
  node("1", "RootWebArea", { name: "Apply", childIds: ["2", "4", "5", "6", "9"] }),
  node("2", "heading", { name: "Apply for this job", childIds: ["3"] }),
  node("3", "StaticText", { name: "Apply for this job" }),
  node("4", "textbox", { name: "First Name", backendDOMNodeId: 11, props: { required: true } }),
  node("5", "textbox", { name: "Email", value: "a@b.com", backendDOMNodeId: 12 }),
  node("6", "generic", { ignored: true, childIds: ["7"] }),
  node("7", "button", { name: "Submit Application", backendDOMNodeId: 13, childIds: ["8"] }),
  node("8", "StaticText", { name: "Submit Application" }),
  node("9", "checkbox", { name: "Subscribe", backendDOMNodeId: 14, props: { checked: "false" } }),
];

test("refs are sequential, namespaced per frame, and map to backend node ids", () => {
  const { refs } = serialize(form(), "f0");
  assert.deepEqual([...refs], [
    ["@f0e1", 11],
    ["@f0e2", 12],
    ["@f0e3", 13],
    ["@f0e4", 14],
  ]);

  // Same tree in an OOPIF must not collide with the main frame's refs.
  assert.deepEqual([...serialize(form(), "f1").refs.keys()], ["@f1e1", "@f1e2", "@f1e3", "@f1e4"]);
});

test("renders role, name, value and only the flags that are on", () => {
  const { text } = serialize(form(), "f0");
  assert.match(text, /@f0e1 \[textbox\] "First Name" \(required\)/);
  assert.match(text, /@f0e2 \[textbox\] "Email" = "a@b\.com"$/m);
  assert.doesNotMatch(text, /checked/); // checked="false" is not a flag that is on
});

test("walks through ignored wrappers but drops text the control already announced", () => {
  const { text } = serialize(form(), "f0");
  assert.match(text, /@f0e3 \[button\] "Submit Application"/); // found under the ignored node
  assert.equal(text.match(/Submit Application/g)?.length, 1); // StaticText echo dropped
  assert.equal(text.match(/Apply for this job/g)?.length, 1);
});

// The Phase 3 gate in one test: body prose was the bulk of every snapshot and
// almost none of what the agent needed to act, since links and buttons carry
// their own labels. Reading tasks ask for it; acting ones no longer pay for it.
test("body prose is dropped by default and comes back with full", () => {
  const page = [
    node("1", "RootWebArea", { name: "Cat", childIds: ["2", "3", "4"] }),
    node("2", "heading", { name: "Cat" }),
    node("3", "StaticText", { name: "The cat is a small domesticated carnivore." }),
    node("4", "link", { name: "Read more", backendDOMNodeId: 7 }),
  ];

  const lean = serialize(page, "f0").text;
  assert.doesNotMatch(lean, /domesticated/); // the expensive half
  assert.match(lean, /\[heading\] "Cat"/); // orientation stays
  assert.match(lean, /@f0e1 \[link\] "Read more"/); // and everything actionable

  assert.match(serialize(page, "f0", { full: true }).text, /domesticated/);
});

// A live run died here: one slider on the page threw out of clean(), and since
// click/navigate/key all return the page, every action after it read as a failed
// action. The agent spent 19 turns and $0.22 concluding the browser was broken.
test("survives non-string AX values", () => {
  const page = [
    node("1", "RootWebArea", { name: "Cat", childIds: ["2", "3"] }),
    node("2", "slider", { name: "Volume", value: 0.5, backendDOMNodeId: 7 }),
    node("3", "checkbox", { name: "Mute", value: true, backendDOMNodeId: 8 }),
  ];
  const { text } = serialize(page, "f0");
  assert.match(text, /@f0e1 \[slider\] "Volume" = "0\.5"/);
  assert.match(text, /@f0e2 \[checkbox\] "Mute" = "true"/);
});

const many = () => [
  node("1", "RootWebArea", { childIds: Array.from({ length: 50 }, (_, i) => `b${i}`) }),
  ...Array.from({ length: 50 }, (_, i) => node(`b${i}`, "button", { name: `B${i}`, backendDOMNodeId: i })),
];

test("caps the payload and names the call that reads past the cap", () => {
  const lines = serialize(many(), "f0", { maxLines: 10 }).text.split("\n");
  assert.equal(lines.length, 11); // 10 kept + the notice
  assert.match(lines.at(-1)!, /40 more lines below/);
  // Greenhouse's country flyout overflowed this cap and the notice used to say
  // "scroll or narrow the page" — neither of which the agent could do. The
  // recovery it names now has to be a call that exists.
  assert.match(lines.at(-1)!, /from: 10/);
});

test("from: reads on where the cap stopped, without renumbering refs", () => {
  const head = serialize(many(), "f0", { maxLines: 10 });
  const rest = serialize(many(), "f0", { maxLines: 10, from: 10 });

  assert.match(head.text, /@f0e1 \[button\] "B0"/);
  assert.doesNotMatch(head.text, /"B10"/);
  assert.match(rest.text, /@f0e11 \[button\] "B10"/); // e11, not e1 — same node, same ref
  assert.match(rest.text.split("\n")[0]!, /10 earlier lines not shown/);
  assert.match(rest.text, /from: 20/);

  // Every ref is minted during the walk, before the window is cut, so a ref the
  // agent can only see on a later page still resolves on the first one.
  assert.deepEqual([...head.refs], [...rest.refs]);
});

test("the last page of a paginated read has no read-on notice", () => {
  const { text } = serialize(many(), "f0", { maxLines: 10, from: 40 });
  assert.match(text, /"B49"/);
  assert.doesNotMatch(text, /more lines below/);
});

// An out-of-range `from` used to be the obvious way to get an empty page and a
// tool result that reads as a broken browser rather than a bad argument.
test("a from past the end returns just the marker, not a crash", () => {
  const { text } = serialize(many(), "f0", { maxLines: 10, from: 999 });
  assert.equal(text, "… 999 earlier lines not shown (reading from line 999)");
});
