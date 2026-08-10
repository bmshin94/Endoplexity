/**
 * A LaTeX subset -> MathML.
 *
 * Why this exists at all: the panel had no math path, so an agent that answered
 * with $\frac{-b \pm \sqrt{b^2-4ac}}{2a}$ printed exactly those characters.
 *
 * Why not KaTeX or MathJax: the panel runs under a strict CSP with no external
 * host, so a library has to be vendored into the repo — KaTeX is ~280KB of JS
 * plus a font file, for a feature that shows up in a minority of answers. MathML
 * is a native browser feature (Chrome 109+), which is the cheaper rung: the
 * browser owns layout, spacing and fonts, and this file only has to translate.
 *
 * Same locked rule as md.js: nothing here reaches innerHTML. MathML elements
 * need createElementNS rather than createElement — an element in the HTML
 * namespace named "mfrac" is an unknown inline element, not a fraction.
 *
 * parseMath() is pure and DOM-free so `node --test` can exercise the grammar
 * without a browser, the same trick md.test.ts already uses.
 */

const MML = "http://www.w3.org/1998/Math/MathML";

// Only what actually turns up in an assistant's answer. An unknown macro renders
// as its own name rather than vanishing, so a gap looks like a gap.
const SYMBOL = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", div: "÷", pm: "±", mp: "∓", cdot: "⋅", ast: "∗", star: "⋆",
  circ: "∘", bullet: "∙", oplus: "⊕", ominus: "⊖", otimes: "⊗",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈",
  equiv: "≡", cong: "≅", sim: "∼", simeq: "≃", propto: "∝", ll: "≪", gg: "≫",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃", neg: "¬",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃",
  supseteq: "⊇", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅",
  land: "∧", lor: "∨", wedge: "∧", vee: "∨",
  rightarrow: "→", to: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", mapsto: "↦",
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", dots: "…",
  perp: "⊥", parallel: "∥", angle: "∠", triangle: "△", square: "□",
  therefore: "∴", because: "∵", checkmark: "✓", prime: "′", degree: "°",
  hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", surd: "√",
};

// Grow vertically and, in display mode, take their scripts above and below.
const BIG = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", oint: "∮", bigcup: "⋃", bigcap: "⋂", lim: "lim" };

// Upright, because they are names rather than a product of single-letter variables.
const FUNCTIONS = new Set([
  "sin", "cos", "tan", "csc", "sec", "cot", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "exp", "det", "dim", "ker", "deg",
  "gcd", "min", "max", "sup", "inf", "arg", "Pr", "mod",
]);

// ponytail: the seven blackboard letters anyone actually writes. The rest fall
// through as plain letters, which is wrong-looking but readable.
const BLACKBOARD = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", E: "𝔼" };

const SPACES = { ",": 0.17, ":": 0.22, ";": 0.28, "!": -0.17, " ": 0.25, quad: 1, qquad: 2 };

// ASCII operators that have a real typographic counterpart. A hyphen-minus set
// as a minus sign is the single most visible tell that math was faked with text.
const GLYPH = { "-": "−", "*": "∗", "'": "′", "<": "<", ">": ">" };

const TOKEN = /\\[a-zA-Z]+|\\.|\d+(?:\.\d+)?|[a-zA-Z]|\s+|[\s\S]/g;

const isSpace = (t) => typeof t === "string" && /^\s+$/.test(t);

/** A cursor over the token list. Whitespace is kept, and skipped by every reader but \text. */
function reader(src) {
  const ts = String(src ?? "").match(TOKEN) ?? [];
  let i = 0;
  return {
    get done() {
      while (i < ts.length && isSpace(ts[i])) i++;
      return i >= ts.length;
    },
    peek() {
      while (i < ts.length && isSpace(ts[i])) i++;
      return ts[i];
    },
    take() {
      while (i < ts.length && isSpace(ts[i])) i++;
      return ts[i++];
    },
    /** Raw, whitespace included — \text is the one place spacing is content. */
    takeRaw() {
      return ts[i++];
    },
    at: () => i,
  };
}

const row = (kids) => (kids.length === 1 ? kids[0] : { k: "row", kids });

function group(r) {
  if (r.peek() !== "{") return atom(r);
  r.take();
  const kids = sequence(r, "}");
  if (r.peek() === "}") r.take();
  return row(kids);
}

/** \text{...} keeps its spaces, so it reads the raw stream rather than the token one. */
function textArg(r) {
  if (r.peek() !== "{") return { k: "t", v: String(r.take() ?? "") };
  r.take();
  let depth = 1;
  let out = "";
  while (true) {
    const t = r.takeRaw();
    if (t === undefined) break;
    if (t === "{") depth++;
    if (t === "}" && --depth === 0) break;
    out += t;
  }
  return { k: "t", v: out };
}

function macro(r, name) {
  if (name === "frac" || name === "dfrac" || name === "tfrac") {
    return { k: "frac", a: group(r), b: group(r) };
  }
  if (name === "sqrt") {
    // \sqrt[3]{x} — an optional index before the radicand.
    let index = null;
    if (r.peek() === "[") {
      r.take();
      index = row(sequence(r, "]"));
      if (r.peek() === "]") r.take();
    }
    return { k: "root", a: group(r), index };
  }
  if (name === "text" || name === "textrm" || name === "textbf" || name === "mbox") {
    const node = textArg(r);
    return name === "textbf" ? { ...node, cls: "bold" } : node;
  }
  if (name === "mathbb") {
    const inner = textArg(r).v.trim();
    return { k: "i", v: [...inner].map((c) => BLACKBOARD[c] ?? c).join("") };
  }
  if (name === "mathbf" || name === "boldsymbol") return { ...group(r), cls: "bold" };
  if (name === "mathrm" || name === "operatorname") return { k: "i", v: textArg(r).v.trim(), upright: true };
  if (name === "mathit" || name === "mathsf" || name === "mathcal") return group(r);
  if (name === "left") {
    // A fence is an atom, not a sequence-level construct, so that \left(x\right)^2
    // takes the exponent on the bracket rather than dropping it as a stray ^.
    const open = r.take();
    const kids = sequence(r, undefined);
    let close = null;
    if (r.peek() === "\\right") {
      r.take();
      close = r.take();
    }
    return {
      k: "fence",
      open: open === "." ? null : String(open ?? ""),
      close: close === "." || close === undefined ? null : close,
      kids,
    };
  }
  // An unbalanced \right: draw the delimiter and carry on rather than stalling.
  if (name === "right") {
    const d = r.take();
    return d === "." ? { k: "row", kids: [] } : { k: "o", v: String(d ?? "") };
  }
  if (name in BIG) return { k: "o", v: BIG[name], big: true, upright: name === "lim" };
  if (FUNCTIONS.has(name)) return { k: "i", v: name, upright: true };
  if (name in SYMBOL) return { k: "o", v: SYMBOL[name] };
  if (name in SPACES) return { k: "space", w: SPACES[name] };
  // An unknown macro prints its name. Silently dropping it turns a formula into
  // a different, wrong formula, which is worse than an ugly one.
  return { k: "i", v: name, upright: true };
}

function atom(r) {
  const t = r.take();
  if (t === undefined) return { k: "row", kids: [] };

  if (t[0] === "\\") {
    const name = t.slice(1);
    if (/^[a-zA-Z]+$/.test(name)) return macro(r, name);
    // \{ \} \$ \% \& — an escaped literal.
    if (name in SPACES) return { k: "space", w: SPACES[name] };
    return { k: "o", v: name };
  }

  if (/^\d/.test(t)) return { k: "n", v: t };
  if (/^[a-zA-Z]$/.test(t)) return { k: "i", v: t };
  if (t === "{") {
    const kids = sequence(r, "}");
    if (r.peek() === "}") r.take();
    return row(kids);
  }
  return { k: "o", v: GLYPH[t] ?? t };
}

/** One atom plus however many ^ and _ are stacked on it. */
function scripted(r) {
  let base = atom(r);
  let sub = null;
  let sup = null;
  while (r.peek() === "^" || r.peek() === "_") {
    const which = r.take();
    const value = group(r);
    if (which === "^") sup = value;
    else sub = value;
  }
  return sub || sup ? { k: "scripts", base, sub, sup } : base;
}

/**
 * A run of atoms up to `stop`. \left...\right is recognised here rather than in
 * atom() because it brackets a whole sub-sequence.
 */
function sequence(r, stop) {
  const kids = [];
  while (!r.done) {
    const next = r.peek();
    if (next === stop) break;
    if (stop === undefined && (next === "}" || next === "]")) break;
    if (next === "\\right") break;

    const before = r.at();
    kids.push(scripted(r));
    // Every path above consumes; this is the belt on the braces. A grammar that
    // stalls here would hang the panel, and the panel renders page content.
    if (r.at() === before) {
      r.take();
      break;
    }
  }
  return kids;
}

/** LaTeX source -> a node tree. Pure, DOM-free, and it does not throw. */
export function parseMath(src) {
  try {
    return sequence(reader(src), undefined);
  } catch {
    return [{ k: "t", v: String(src ?? "") }];
  }
}

// ---- MathML ------------------------------------------------------------------

function mml(name, ...kids) {
  const el = document.createElementNS(MML, name);
  for (const kid of kids) el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  return el;
}

function toNode(node, display) {
  if (!node) return mml("mrow");
  switch (node.k) {
    case "n":
      return mml("mn", node.v);
    case "t": {
      const el = mml("mtext", node.v);
      if (node.cls) el.setAttribute("class", node.cls);
      return el;
    }
    case "i": {
      const el = mml("mi", node.v);
      // A multi-letter <mi> is upright by default and a single letter italic,
      // which is exactly the convention — only "normal" needs forcing.
      if (node.upright && node.v.length === 1) el.setAttribute("mathvariant", "normal");
      if (node.cls) el.setAttribute("class", node.cls);
      return el;
    }
    case "o": {
      const el = mml("mo", node.v);
      if (node.big) el.setAttribute("largeop", "true");
      if (node.upright) el.setAttribute("movablelimits", "true");
      return el;
    }
    case "space": {
      const el = mml("mspace");
      el.setAttribute("width", `${node.w}em`);
      return el;
    }
    case "frac":
      return mml("mfrac", toNode(node.a, false), toNode(node.b, false));
    case "root":
      return node.index
        ? mml("mroot", toNode(node.a, false), toNode(node.index, false))
        : mml("msqrt", toNode(node.a, false));
    case "scripts": {
      const base = toNode(node.base, display);
      // In display mode a big operator takes its limits above and below, the way
      // a sum is actually written. Inline it stays on the shoulder so the line
      // height does not blow out mid-sentence.
      const stacked = display && node.base?.big;
      if (node.sub && node.sup) {
        return mml(stacked ? "munderover" : "msubsup", base, toNode(node.sub, false), toNode(node.sup, false));
      }
      if (node.sup) return mml(stacked ? "mover" : "msup", base, toNode(node.sup, false));
      return mml(stacked ? "munder" : "msub", base, toNode(node.sub, false));
    }
    case "fence": {
      const kids = [];
      if (node.open) kids.push(mml("mo", node.open));
      kids.push(mml("mrow", ...node.kids.map((k) => toNode(k, display))));
      if (node.close) kids.push(mml("mo", node.close));
      return mml("mrow", ...kids);
    }
    default:
      return mml("mrow", ...(node.kids ?? []).map((k) => toNode(k, display)));
  }
}

/**
 * LaTeX -> a <math> element, or null if anything at all went wrong. Null is a
 * real answer: md.js falls back to showing the source, which is what the panel
 * did before this file existed and is never worse than a blank.
 */
export function mathElement(src, display) {
  try {
    const math = document.createElementNS(MML, "math");
    if (display) math.setAttribute("display", "block");
    for (const node of parseMath(src)) math.appendChild(toNode(node, display));
    return math;
  } catch {
    return null;
  }
}
