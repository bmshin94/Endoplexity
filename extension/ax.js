// Accessibility tree -> the text an agent reads.
//
// Chrome's full tree is mostly noise: layout wrappers, text duplicated from the
// control that already announced it, decorative images. A LinkedIn page is tens
// of thousands of nodes and would eat the whole context window. What survives by
// default is what can be acted on — every one of those carries its own label, so
// a page of links reads fine without a word of body text. Prose comes back with
// `full`, for tasks that are reading the page rather than driving it.

// Roles worth a ref. Chrome reports computed ARIA roles, so <input> and
// <textarea> both land on "textbox" and <input type=file> on "button".
const ACTIONABLE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "colorwell",
]);

// Context only. Iframe is here so a hole in the main tree is visible as a hole —
// its contents live in a separate frame section of the snapshot.
const PROSE = new Set(["StaticText", "heading", "paragraph", "image", "Iframe"]);

// Prose is most of a real page by volume and almost none of what an agent needs
// to act: every link and button already carries its own label. So the default
// keeps only the two kinds that orient — headings, and the marker saying a frame
// has been lifted out — and `full` brings the rest back for reading tasks.
// Measured on the Phase 2 google run: snapshots were the bulk of the bill.
const LEAN_PROSE = new Set(["heading", "Iframe"]);

const FLAGS = new Set(["required", "disabled", "checked", "expanded", "selected", "invalid"]);

// AXValue is not always a string: sliders, spinbuttons and progressbars carry
// numbers, tristates carry booleans. `.replace` on those throws, and since every
// action returns the page, one such node on the page breaks every tool call.
// ponytail: String() also stringifies nodeList/idref values to "[object Object]".
// Ugly, never fatal — give those a real rendering when a page needs it.
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function flagsOf(node) {
  const on = [];
  for (const p of node.properties ?? []) {
    if (!FLAGS.has(p.name)) continue;
    const v = p.value?.value;
    // Tristate and token properties arrive as strings, so "false" is falsy here
    // even though a bare truthiness check would keep it.
    if (v == null || v === false || v === "false" || v === "" || v === "none") continue;
    on.push(v === true ? p.name : `${p.name}=${v}`);
  }
  return on.length ? ` (${on.join(", ")})` : "";
}

function valueOf(node) {
  const v = clean(node.value?.value);
  if (!v) return "";
  return ` = "${v.length > 80 ? `${v.slice(0, 80)}…` : v}"`;
}

/**
 * @param nodes  Accessibility.getFullAXTree result for ONE frame
 * @param frame  frame tag, e.g. "f0" for the main frame — refs come out as @f0e3
 * @param full   keep body prose too. Off by default: the model pays for this on
 *               every later turn, so reading tasks opt in rather than opt out
 * @param from   first line to return, for reading past the cap
 * @returns {{ text: string, refs: Map<string, number> }} refs map to backend DOM node ids
 */
export function serialize(nodes, frame, { maxLines = 300, full = false, from = 0 } = {}) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const isChild = new Set(nodes.flatMap((n) => n.childIds ?? []));
  const roots = nodes.filter((n) => !isChild.has(n.nodeId));

  // Every kept line, before the window is cut out of it. Building the whole list
  // and slicing is what makes `from` possible at all, and costs nothing the walk
  // was not already paying: the tree is traversed in full either way.
  const all = [];
  const refs = new Map();
  let seq = 0;

  // One space per level, not two: indentation is relative, so half of it was
  // pure width. On a deep page that was a few hundred tokens of nothing.
  const emit = (line, depth) => all.push(" ".repeat(Math.min(depth, 8)) + line);

  const walk = (node, depth, announced) => {
    if (!node) return;
    const role = node.role?.value ?? "";
    const name = clean(node.name?.value);
    let childDepth = depth;
    let childAnnounced = announced;

    if (node.ignored) {
      // Ignored nodes are invisible to assistive tech, but their subtree is not
      // necessarily — keep walking.
    } else if (ACTIONABLE.has(role)) {
      const ref = `@${frame}e${++seq}`;
      if (node.backendDOMNodeId != null) refs.set(ref, node.backendDOMNodeId);
      emit(`${ref} [${role}]${name ? ` "${name}"` : ""}${valueOf(node)}${flagsOf(node)}`, depth);
      childDepth = depth + 1;
      childAnnounced = name;
    } else if (PROSE.has(role) && (full || LEAN_PROSE.has(role)) && name && name !== announced) {
      // A button's label shows up again as a StaticText child. Once is enough.
      emit(role === "StaticText" ? `"${name}"` : `[${role}] "${name}"`, depth);
      childDepth = depth + 1;
      childAnnounced = name;
    }

    for (const id of node.childIds ?? []) walk(byId.get(id), childDepth, childAnnounced);
  };

  for (const root of roots) walk(root, 0, "");

  // Refs are minted during the walk, above, and every one of them is in the map
  // regardless of which window is returned. So a hidden line's ref is still
  // usable, and re-reading at a different `from` renumbers nothing — the walk is
  // deterministic, so @f0e17 means the same node in every page of the same read.
  const start = Math.max(0, Math.trunc(from) || 0);
  const lines = all.slice(start, start + maxLines);
  // Clamped: a `from` past the end makes this negative, which printed
  // "… -949 more lines below" and pointed the agent at a further page that does
  // not exist — a loop it has no reason to break out of.
  const below = Math.max(0, all.length - start - lines.length);

  // Greenhouse's country flyout is 307 lines into a 300 cap, and the old notice
  // told the model to "scroll or narrow the page" — neither of which it could
  // do, and neither of which would have helped. A recovery message must name an
  // action the agent can actually take, so this one names the exact call.
  if (start) lines.unshift(`… ${start} earlier lines not shown (reading from line ${start})`);
  if (below) lines.push(`… ${below} more lines below — call snapshot with from: ${start + maxLines} to read on`);

  return { text: lines.join("\n"), refs };
}
