/**
 * Markdown -> DOM, built only out of createElement and createTextNode.
 *
 * This renders text that came off arbitrary websites, so the locked rule is
 * that it must never reach innerHTML. A sanitiser does not satisfy that:
 * DOMPurify parses markup through template.innerHTML internally, which means
 * trusting a blocklist to stay ahead of parser quirks. Building nodes instead
 * has no string->markup step anywhere, so the whole class of bug is absent
 * rather than defended against.
 *
 * parse() is deliberately pure and DOM-free so it can be tested under
 * `node --test` with no browser — the same trick gate.test.ts already uses to
 * test ax.js from the bridge's suite.
 */

import { mathElement } from "./math.js";

// Only http(s) links survive as links. javascript:, data: and friends become
// plain text carrying their original source, so a hostile page cannot smuggle
// a scheme through a label. Deciding it here rather than in toDom keeps the
// policy unit-testable and leaves the DOM half too dumb to get it wrong.
const SAFE_HREF = /^https?:\/\//i;

/**
 * One pass over a line's inline syntax. Order inside this alternation is the
 * whole contract:
 *   code first, so backticked text is never re-scanned for anything;
 *   math before links, so \(x_1\) is not read as a bracket;
 *   links before emphasis, so a label containing * survives;
 *   ** and __ before * so the longer fence wins.
 * Named groups rather than indices — this got long enough that counting
 * parentheses was going to be the bug.
 */
const INLINE = new RegExp(
  [
    /(?<tick>`+)(?<code>[\s\S]*?)\k<tick>/,
    /\$\$(?<dmath>[^\n]+?)\$\$/,
    /\\\[(?<dmath2>[\s\S]+?)\\\]/,
    /\\\((?<pmath>[\s\S]+?)\\\)/,
    /\$(?<imath>(?!\s)(?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/,
    /(?<bang>!?)\[(?<label>[^\]]*)\]\((?<href>[^\s)]+)\)/,
    /\*\*(?<strong>[\s\S]+?)\*\*/,
    /__(?<strongAlt>[\s\S]+?)__/,
    /~~(?<del>[\s\S]+?)~~/,
    /\*(?<em>[^*\n]+?)\*/,
  ]
    .map((r) => r.source)
    .join("|"),
  "g",
);

// A bare $ is money far more often than it is math, and "$5-$10" is a real
// sentence an agent writes about pricing. Requiring one structural LaTeX
// character costs nothing — no actual equation lacks all five — and it makes
// the currency false positive impossible rather than unlikely.
const LATEXY = /[\\^_{=]/;

const FENCE = /^\s*```(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
// One regex for both list kinds, because nesting has to compare indents across
// them: "1." with a "-" child is ordinary markdown.
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
// A table's second line: pipes, dashes, colons and spaces, with at least one dash.
const DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const MATH_OPEN = /^\s*(\$\$|\\\[)(.*)$/;

const text = (v) => ({ t: "text", v });

/** Split one markdown line into inline tokens. Never throws. */
function inline(line) {
  const src = String(line ?? "");
  const out = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m; (m = INLINE.exec(src)); ) {
    const g = m.groups;
    // Skipping without touching `last` leaves the source text to be picked up
    // by the slice below, so a rejected match degrades to literal text.
    // We render no images at all — an <img src> pointing anywhere is a read
    // receipt for whoever wrote the page — so ![alt](url) stays literal.
    if (g.label !== undefined && (g.bang === "!" || !SAFE_HREF.test(g.href))) continue;
    if (g.imath !== undefined && !LATEXY.test(g.imath)) continue;

    if (m.index > last) out.push(text(src.slice(last, m.index)));
    if (g.code !== undefined) out.push({ t: "code", v: g.code });
    else if (g.dmath !== undefined || g.dmath2 !== undefined) out.push({ t: "math", v: g.dmath ?? g.dmath2, display: true });
    else if (g.pmath !== undefined || g.imath !== undefined) out.push({ t: "math", v: g.pmath ?? g.imath });
    else if (g.label !== undefined) out.push({ t: "link", v: g.label, href: g.href });
    else if (g.strong !== undefined || g.strongAlt !== undefined) out.push({ t: "strong", v: g.strong ?? g.strongAlt });
    else if (g.del !== undefined) out.push({ t: "del", v: g.del });
    else out.push({ t: "em", v: g.em });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(text(src.slice(last)));
  return out.length ? out : [text("")];
}

const cells = (line) =>
  String(line)
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    // ponytail: a literal \| inside a cell splits it. Real agent output does
    // not contain one; fix it the day something does.
    .split("|")
    .map((c) => inline(c.trim()));

const isTable = (lines, i) =>
  lines[i].includes("|") && i + 1 < lines.length && DIVIDER.test(lines[i + 1]) && lines[i + 1].includes("|");

/** Does a new block start here? The paragraph run reads this to know where to stop. */
const opensBlock = (lines, i) =>
  !lines[i].trim() ||
  FENCE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  RULE.test(lines[i]) ||
  QUOTE.test(lines[i]) ||
  ITEM.test(lines[i]) ||
  MATH_OPEN.test(lines[i]) ||
  isTable(lines, i);

/**
 * Nesting, by indent. Markdown's own rule is "indented past the parent's
 * marker", and agents are not consistent about whether that is two spaces or
 * four, so this compares indents relatively rather than in fixed steps.
 * A tab counts as four columns.
 */
function build(raw, at, indent) {
  const t = raw[at].ordered ? "ol" : "ul";
  const items = [];
  let i = at;
  while (i < raw.length && raw[i].indent >= indent) {
    if (raw[i].indent > indent) {
      const [child, next] = build(raw, i, raw[i].indent);
      // A deeper item with no parent above it (the agent over-indented the very
      // first bullet) becomes a list in its own right rather than disappearing.
      if (items.length) (items[items.length - 1].children ??= []).push(child);
      else items.push({ inline: [text("")], children: [child] });
      i = next;
      continue;
    }
    // Switching between - and 1. at the same depth is a new list, not an item.
    if (raw[i].ordered !== (t === "ol")) break;
    const task = TASK.exec(raw[i].text);
    items.push(
      task ? { inline: inline(task[2]), done: task[1].toLowerCase() === "x" } : { inline: inline(raw[i].text) },
    );
    i++;
  }
  return [{ t, items }, i];
}

/**
 * Markdown source -> an array of blocks. Pure, no DOM, and it never throws:
 * a half-written table, an unterminated fence or a null argument all degrade
 * to paragraphs rather than raising. Actions return the page they produced, so
 * anything that breaks rendering reads as a broken action.
 */
export function parse(src) {
  const lines = String(src ?? "").split(/\r?\n/);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence, or past the end if it never came
      blocks.push({ t: "code", lang: fence[1].trim(), text: body.join("\n") });
      continue;
    }

    // Before RULE, or a table's divider row reads as a horizontal rule.
    if (isTable(lines, i)) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ t: "table", head, rows });
      continue;
    }

    // $$ ... $$ or \[ ... \], on one line or spread over several.
    const math = MATH_OPEN.exec(line);
    if (math) {
      const closer = math[1] === "$$" ? "$$" : "\\]";
      const rest = math[2];
      const end = rest.lastIndexOf(closer);
      if (end >= 0) {
        blocks.push({ t: "math", text: rest.slice(0, end).trim() });
        i++;
        continue;
      }
      const body = rest ? [rest] : [];
      i++;
      while (i < lines.length && !lines[i].includes(closer)) body.push(lines[i++]);
      if (i < lines.length) body.push(lines[i].slice(0, lines[i].indexOf(closer)));
      i++;
      blocks.push({ t: "math", text: body.join("\n").trim() });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: "h", level: heading[1].length, inline: inline(heading[2]) });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])[1]);
      blocks.push({ t: "quote", inline: inline(body.join(" ")) });
      continue;
    }

    if (ITEM.test(line)) {
      const raw = [];
      while (i < lines.length && ITEM.test(lines[i])) {
        const [, pad, marker, body] = ITEM.exec(lines[i++]);
        raw.push({ indent: pad.replace(/\t/g, "    ").length, ordered: /\d/.test(marker), text: body });
      }
      // One run of item lines can hold several sibling lists — a ul, then an ol
      // at the same depth — so keep building until every line is placed.
      let at = 0;
      while (at < raw.length) {
        const [list, next] = build(raw, at, raw[at].indent);
        blocks.push(list);
        at = next > at ? next : at + 1;
      }
      continue;
    }

    const para = [];
    while (i < lines.length && !opensBlock(lines, i)) para.push(lines[i++]);
    blocks.push({ t: "p", inline: inline(para.join(" ")) });
  }

  return blocks;
}

// ---- DOM ---------------------------------------------------------------------

/** Math that could not be parsed shows its source rather than a blank. */
function mathInto(parent, src, display) {
  const node = mathElement(src, display);
  if (node) return void parent.appendChild(node);
  const fallback = document.createElement("code");
  fallback.className = "math-raw";
  fallback.textContent = String(src ?? "");
  parent.appendChild(fallback);
}

function inlineInto(parent, tokens) {
  for (const token of tokens ?? []) {
    const v = String(token?.v ?? "");
    if (token?.t === "link") {
      const a = document.createElement("a");
      a.href = token.href;
      a.target = "_blank";
      // Untrusted destination: never let it reach back into this page.
      a.rel = "noopener noreferrer";
      a.textContent = v;
      parent.appendChild(a);
      continue;
    }
    if (token?.t === "math") {
      mathInto(parent, v, token.display === true);
      continue;
    }
    const tag = { code: "code", strong: "strong", em: "em", del: "del" }[token?.t];
    if (!tag) {
      parent.appendChild(document.createTextNode(v));
      continue;
    }
    const el = document.createElement(tag);
    el.textContent = v;
    parent.appendChild(el);
  }
}

const row = (tag, cellSets) => {
  const tr = document.createElement("tr");
  for (const set of cellSets) {
    const cell = document.createElement(tag);
    inlineInto(cell, set);
    tr.appendChild(cell);
  }
  return tr;
};

function listInto(frag, block) {
  const list = document.createElement(block.t);
  for (const item of block.items ?? []) {
    const li = document.createElement("li");
    if (item.done !== undefined) {
      li.className = "task";
      // A real disabled checkbox: native, announced by screen readers as
      // checked or not, and free.
      const box = document.createElement("input");
      box.type = "checkbox";
      box.disabled = true;
      box.checked = item.done;
      li.appendChild(box);
    }
    const line = document.createElement("span");
    inlineInto(line, item.inline);
    li.appendChild(line);
    for (const child of item.children ?? []) li.appendChild(toDom([child]));
    list.appendChild(li);
  }
  frag.appendChild(list);
}

/** Blocks -> a DocumentFragment. createElement only, never innerHTML. */
export function toDom(blocks) {
  const frag = document.createDocumentFragment();
  for (const block of blocks ?? []) {
    if (block.t === "hr") {
      frag.appendChild(document.createElement("hr"));
      continue;
    }
    if (block.t === "math") {
      const wrap = document.createElement("div");
      wrap.className = "math-block";
      mathInto(wrap, block.text, true);
      frag.appendChild(wrap);
      continue;
    }
    if (block.t === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = String(block.text ?? "");
      if (block.lang) code.dataset.lang = block.lang;
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }
    if (block.t === "ul" || block.t === "ol") {
      listInto(frag, block);
      continue;
    }
    if (block.t === "table") {
      // The scroll box is the table's own, so a wide table never widens the panel.
      const scroller = document.createElement("div");
      scroller.className = "table-scroll";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      thead.appendChild(row("th", block.head ?? []));
      const tbody = document.createElement("tbody");
      for (const r of block.rows ?? []) tbody.appendChild(row("td", r));
      table.append(thead, tbody);
      scroller.appendChild(table);
      frag.appendChild(scroller);
      continue;
    }
    const el = document.createElement(
      block.t === "h" ? `h${Math.min(6, Math.max(1, block.level ?? 1))}` : block.t === "quote" ? "blockquote" : "p",
    );
    inlineInto(el, block.inline);
    frag.appendChild(el);
  }
  return frag;
}

export const render = (src) => toDom(parse(src));
