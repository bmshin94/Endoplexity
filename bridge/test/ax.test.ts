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
    value?: string;
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

test("caps the payload and says how much it hid", () => {
  const many = [
    node("1", "RootWebArea", { childIds: Array.from({ length: 50 }, (_, i) => `b${i}`) }),
    ...Array.from({ length: 50 }, (_, i) => node(`b${i}`, "button", { name: `B${i}`, backendDOMNodeId: i })),
  ];
  const lines = serialize(many, "f0", { maxLines: 10 }).text.split("\n");
  assert.equal(lines.length, 11); // 10 kept + the notice
  assert.match(lines.at(-1)!, /40 more nodes hidden/);
});
