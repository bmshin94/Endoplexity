/**
 * The approval policy — the only place that decides whether a bridge action
 * needs a human before it runs. Not the transport (relay.ts owns the panel
 * socket and the pending map) and not Chrome (the panel owns that) — just
 * the rule.
 *
 * The bridge already has everything it needs to decide: every
 * snapshot/navigate/click/key result relayed back is page text produced by
 * extension/ax.js's serialize(), shaped like
 *   @f0e38 [button] "Submit Application" (required)
 * so a ref -> label map built from that text, kept current as results come
 * back, is enough to tell an irreversible click from an ordinary one — no
 * extra round trip to the panel to ask "what does this ref point at".
 */

// One actionable line out of serialize(): "@ref [role] "name"", optionally
// followed by a value or flags this policy does not need.
const LINE = /^\s*(@\S+)\s+(\[[a-zA-Z]+\]\s+"[^"]*")/;

let labels = new Map<string, string>();

/**
 * Parse relayed page text and replace the ref -> label map wholesale. Refs
 * are per-page — cdp.js mints a fresh generation on every snapshot and
 * invalidates the last one — so there is nothing to merge in.
 *
 * Text with no ref lines is not a page at all: it's an ack like
 * "typed 4 characters into @f0e8" (tools.js's `type` return). Leaving the
 * map untouched in that case means a mid-form `type` call doesn't blind the
 * gate to the buttons the last real snapshot found.
 */
export function remember(text: string): void {
  const found = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (m) found.set(m[1], m[2]);
  }
  if (found.size === 0) return;
  labels = found;
}

// ponytail: a label heuristic, not semantic understanding of the page — the
// known ceiling. False positives ("Apply filters") prompt harmlessly, one
// extra dismiss click. False negatives (irreversible action phrased without
// any of these words) slip through ungated. Phase 6 tunes this against 3
// real job sites instead of guessing further now.
const IRREVERSIBLE = /\b(submit|apply|pay|buy|purchase|order|checkout|confirm|delete|remove|send|book|sign up|accept|agree)\b/i;

/**
 * Does this tool call need a human? Only `click`, and only when its ref
 * resolves to a label that reads as irreversible. Returns a one-line
 * description for the approval prompt, or null to let it run.
 */
export function check(name: string, args: Record<string, unknown>): string | null {
  if (name !== "click") return null;
  const ref = args.ref;
  if (typeof ref !== "string") return null;
  const label = labels.get(ref);
  // Not in the map: the ref is stale or never existed. The panel is about to
  // reject it with "unknown/stale ref" on its own, so gating it buys
  // nothing and just trains the human to rubber-stamp the prompt.
  if (!label) return null;
  if (!IRREVERSIBLE.test(label)) return null;
  return `click ${ref} ${label}`;
}
