import { test } from "node:test";
import assert from "node:assert/strict";
// The panel's renderer, tested from the bridge's suite — same trick
// gate.test.ts uses on ax.js. parse() is DOM-free precisely so this works.
import { parse } from "../../extension/md.js";

const flat = (tokens: { v?: string }[]) => tokens.map((t) => t.v ?? "").join("");

test("a GFM table becomes one table block with head and rows", () => {
  const [block] = parse("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
  assert.equal(block.t, "table");
  assert.deepEqual(block.head.map(flat), ["a", "b"]);
  assert.deepEqual(block.rows.map((r: { v?: string }[][]) => r.map(flat)), [
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("a fenced block is never re-parsed for markup inside it", () => {
  const blocks = parse("```js\n**not bold**\n| a | b |\n```");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].t, "code");
  assert.equal(blocks[0].lang, "js");
  assert.equal(blocks[0].text, "**not bold**\n| a | b |");
});

test("a javascript: link is text, not a link", () => {
  const [{ inline }] = parse("[x](javascript:alert(1))");
  assert.equal(inline.some((t: { t: string }) => t.t === "link"), false);
  assert.equal(flat(inline), "[x](javascript:alert(1))");
});

test("an http(s) link is a link, and keeps its href", () => {
  const [{ inline }] = parse("see [docs](https://example.com/a)");
  const link = inline.find((t: { t: string }) => t.t === "link");
  assert.equal(link.href, "https://example.com/a");
  assert.equal(link.v, "docs");
});

test("an image stays literal text — we render no <img> at all", () => {
  const [{ inline }] = parse("![alt](https://example.com/a.png)");
  assert.equal(inline.some((t: { t: string }) => t.t === "link"), false);
  assert.equal(flat(inline), "![alt](https://example.com/a.png)");
});

test("a literal script tag is just text", () => {
  const [{ inline }] = parse("<script>alert(1)</script>");
  assert.equal(flat(inline), "<script>alert(1)</script>");
  assert.equal(inline.every((t: { t: string }) => t.t === "text"), true);
});

test("an unterminated fence does not throw and keeps its body", () => {
  const blocks = parse("```\nstill open");
  assert.equal(blocks[0].t, "code");
  assert.equal(blocks[0].text, "still open");
});

test("empty and nullish input do not throw", () => {
  assert.deepEqual(parse(""), []);
  assert.deepEqual(parse(null), []);
  assert.deepEqual(parse(undefined), []);
});

test("headings, lists, quotes and rules each produce their block", () => {
  assert.equal(parse("## Title")[0].t, "h");
  assert.equal(parse("## Title")[0].level, 2);
  assert.equal(parse("- one\n- two")[0].t, "ul");
  assert.equal(parse("- one\n- two")[0].items.length, 2);
  assert.equal(parse("1. one\n2. two")[0].t, "ol");
  assert.equal(parse("> quoted")[0].t, "quote");
  assert.equal(parse("---")[0].t, "hr");
});

test("bold, italic and inline code survive as their own tokens", () => {
  const [{ inline }] = parse("a **b** c *d* e `f`");
  const kinds = inline.map((t: { t: string }) => t.t);
  assert.ok(kinds.includes("strong"));
  assert.ok(kinds.includes("em"));
  assert.ok(kinds.includes("code"));
});

test("a table divider is not mistaken for a horizontal rule", () => {
  assert.equal(parse("| a |\n|---|\n| 1 |")[0].t, "table");
});

// ---- what the agents actually emit, and the panel used to print literally ----

test("headings go all the way to h6, and do not swallow the next line", () => {
  const blocks = parse("#### Deep\nbody text");
  assert.equal(blocks[0].t, "h");
  assert.equal(blocks[0].level, 4);
  assert.equal(blocks[1].t, "p");
  assert.equal(flat(blocks[1].inline), "body text");
  assert.equal(parse("###### Deepest")[0].level, 6);
});

test("__bold__ and ~~struck~~ are their own tokens", () => {
  const [{ inline }] = parse("a __b__ c ~~d~~");
  const kinds = inline.map((t: { t: string }) => t.t);
  assert.ok(kinds.includes("strong"));
  assert.ok(kinds.includes("del"));
});

test("lists nest by indent, across markers", () => {
  const [list] = parse("- top\n  - nested\n    - deeper");
  assert.equal(list.t, "ul");
  assert.equal(list.items.length, 1);
  const nested = list.items[0].children[0];
  assert.equal(nested.t, "ul");
  assert.equal(flat(nested.items[0].inline), "nested");
  assert.equal(nested.items[0].children[0].items.length, 1);
});

test("a tab indents as four columns, so tabbed nesting is not flattened", () => {
  const [list] = parse("- top\n\t- nested");
  assert.equal(list.items[0].children[0].t, "ul");
});

test("an ordered list after a bullet list at the same depth is a second list", () => {
  const blocks = parse("- a\n- b\n1. one\n2. two");
  assert.equal(blocks[0].t, "ul");
  assert.equal(blocks[1].t, "ol");
  assert.equal(blocks[1].items.length, 2);
});

test("task items carry their checked state and lose the brackets", () => {
  const [list] = parse("- [ ] todo\n- [x] done");
  assert.equal(list.items[0].done, false);
  assert.equal(flat(list.items[0].inline), "todo");
  assert.equal(list.items[1].done, true);
});

test("$$ and \\[ produce a math block, on one line or several", () => {
  assert.deepEqual(parse("$$x^2$$"), [{ t: "math", text: "x^2" }]);
  assert.deepEqual(parse("\\[ x^2 \\]"), [{ t: "math", text: "x^2" }]);
  assert.equal(parse("$$\n\\frac{a}{b}\n$$")[0].text, "\\frac{a}{b}");
});

test("inline math survives as a math token, in both spellings", () => {
  const [{ inline }] = parse("so $E = mc^2$ and \\(x_1\\) hold");
  const math = inline.filter((t: { t: string }) => t.t === "math");
  assert.equal(math.length, 2);
  assert.equal(math[0].v, "E = mc^2");
  assert.equal(math[1].v, "x_1");
});

// The reason inline math needs a guard at all: an agent writes about money far
// more often than it writes about algebra, and "$5-$10" is a real sentence.
test("prices are not equations", () => {
  const [{ inline }] = parse("it costs $5-$10 per run, or $12 monthly");
  assert.equal(inline.some((t: { t: string }) => t.t === "math"), false);
  assert.equal(flat(inline), "it costs $5-$10 per run, or $12 monthly");
});

test("a dollar sign inside backticks is never math", () => {
  const [{ inline }] = parse("run `echo $HOME_{x}` first");
  assert.equal(inline.some((t: { t: string }) => t.t === "math"), false);
});
