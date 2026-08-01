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

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

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
 * @returns {{ text: string, refs: Map<string, number> }} refs map to backend DOM node ids
 */
export function serialize(nodes, frame, { maxLines = 300, full = false } = {}) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const isChild = new Set(nodes.flatMap((n) => n.childIds ?? []));
  const roots = nodes.filter((n) => !isChild.has(n.nodeId));

  const lines = [];
  const refs = new Map();
  let seq = 0;
  let dropped = 0;

  // One space per level, not two: indentation is relative, so half of it was
  // pure width. On a deep page that was a few hundred tokens of nothing.
  const emit = (line, depth) => {
    if (lines.length >= maxLines) return void dropped++;
    lines.push(" ".repeat(Math.min(depth, 8)) + line);
  };

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
  // ponytail: hard cap, no pagination. Add a cursor when a real page actually
  // overflows 300 kept nodes and the tail turns out to matter.
  if (dropped) lines.push(`… ${dropped} more nodes hidden (cap ${maxLines}) — scroll or narrow the page`);

  return { text: lines.join("\n"), refs };
}
