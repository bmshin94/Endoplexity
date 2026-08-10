import { test } from "node:test";
import assert from "node:assert/strict";
// The LaTeX half of the panel's renderer. parseMath() is DOM-free for exactly
// this reason — the MathML half needs a browser, the grammar does not.
import { parseMath } from "../../extension/math.js";

type Node = { k: string; v?: string; a?: Node; b?: Node; base?: Node; sub?: Node; sup?: Node; kids?: Node[]; index?: Node };

const one = (src: string): Node => {
  const nodes = parseMath(src);
  assert.equal(nodes.length, 1, `expected one node from ${src}, got ${nodes.length}`);
  return nodes[0];
};

test("a fraction takes both arguments", () => {
  const frac = one("\\frac{a}{b}");
  assert.equal(frac.k, "frac");
  assert.equal(frac.a.v, "a");
  assert.equal(frac.b.v, "b");
});

test("sub and sup on one base collapse into a single scripts node", () => {
  const node = one("x_i^2");
  assert.equal(node.k, "scripts");
  assert.equal(node.base.v, "x");
  assert.equal(node.sub.v, "i");
  assert.equal(node.sup.v, "2");
});

// The bug this pins: \left...\right used to be handled a level above the
// scripts rule, so the exponent on a bracket fell off as a stray ^ operator.
test("a \\left...\\right fence takes its own exponent", () => {
  const node = one("\\left(\\frac{a}{b}\\right)^2");
  assert.equal(node.k, "scripts");
  assert.equal(node.base.k, "fence");
  assert.equal(node.base.open, "(");
  assert.equal(node.base.close, ")");
  assert.equal(node.sup.v, "2");
});

test("\\sqrt takes an optional index", () => {
  assert.equal(one("\\sqrt{x}").index, null);
  assert.equal(one("\\sqrt[3]{x}").index.v, "3");
});

test("\\text keeps its spaces, which the tokeniser otherwise drops", () => {
  assert.deepEqual(one("\\text{cost per run}"), { k: "t", v: "cost per run" });
});

test("a big operator is marked, so display mode can stack its limits", () => {
  const node = one("\\sum_{i=1}^{n}");
  assert.equal(node.base.big, true);
  assert.equal(node.base.v, "∑");
});

test("ASCII hyphen becomes a real minus sign", () => {
  assert.deepEqual(parseMath("a-b").map((n: Node) => n.v), ["a", "−", "b"]);
});

test("an unknown macro prints its own name rather than vanishing", () => {
  // Dropping it silently would turn a formula into a different, valid-looking
  // formula, which is worse than an ugly one.
  const nodes = parseMath("\\bogus{z}");
  assert.equal(nodes[0].v, "bogus");
  assert.equal(nodes[1].v, "z");
});

test("malformed input terminates and does not throw", () => {
  // Every one of these has an unbalanced or missing argument. The grammar must
  // consume a token per iteration or the panel hangs on page content.
  for (const src of ["\\frac{a", "{{{", "x^", "\\left(", "\\right)", "}}}", "\\sqrt[", "$", ""]) {
    assert.doesNotThrow(() => parseMath(src), src);
  }
  assert.deepEqual(parseMath(null), []);
});
