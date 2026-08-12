/**
 * @-mentioning a tab: turning what was typed back into tabs the agent can open.
 *
 * DOM-free on purpose, like md.js and sessions.js — panel.js owns the menu and
 * the caret, this owns the two rules that are easy to get quietly wrong: what a
 * mention is called, and which mentions survive to be sent.
 *
 * A mention carries no page CONTENT. It hands the model the tab's id in the
 * exact shape the `tabs` tool already returns, so `use_tab` is the obvious next
 * call. Inlining the other tab's text instead would mean detaching from the
 * attached tab to snapshot it — killing every ref the agent holds — and paying
 * for a whole page on every later turn whether it was read or not.
 */

/** Titles run long and the label has to sit inside a ~360px composer. */
export function label(tab) {
  const name = (tab.title || tab.url || "").trim().replace(/\s+/g, " ");
  return name.length > 32 ? `${name.slice(0, 31)}…` : name;
}

/**
 * The mentions still named in what is about to be sent.
 *
 * Backspacing a mention out of the box has to un-mention it, or a tab you
 * thought you had removed still rides along and the agent acts on it. Matching
 * on the inserted label is the cheap version of that bookkeeping: no caret
 * tracking, no chip widget, and the composer stays a plain <textarea>.
 */
export const kept = (text, mentions) => mentions.filter((m) => text.includes(`@${m.label}`));

/**
 * The context block, or null if nothing was mentioned.
 *
 * Deliberately the same line shape as the `tabs` tool's own return — id first,
 * then title and url — so the model reads it as something it already knows how
 * to act on rather than as prose about tabs.
 */
export function block(text, mentions) {
  const on = kept(text, mentions);
  if (!on.length) return null;
  return [
    "Tabs the user pointed at, already open — read one with use_tab:",
    ...on.map((m) => `  id ${m.id} — "${m.title}" ${m.url}`),
  ].join("\n");
}
