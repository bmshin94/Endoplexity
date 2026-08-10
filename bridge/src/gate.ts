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

// Look up a ref's label without gating anything, for the UI to render e.g.
// `clicked "Submit application"` instead of a bare ref. Undefined for a
// stale/unknown ref — same "not on the current page" case check() below
// treats as nothing worth blocking on.
export function labelFor(ref: string): string | undefined {
  return labels.get(ref);
}

// ponytail: a label heuristic, not semantic understanding of the page — the
// known ceiling. False positives ("Apply filters") prompt harmlessly, one
// extra dismiss click. False negatives (irreversible action phrased without
// any of these words) slip through ungated. Phase 6 tunes this against 3
// real job sites instead of guessing further now.
//
// "accept"/"agree" removed: every cookie-consent "Accept all" / "I agree"
// wall matched this and stopped the run for a human, and the dialog blocks
// the page underneath too, so the agent burned turns on a dialog it could
// not otherwise dismiss. Residual, accepted: a page whose ONLY irreversible
// control reads "I accept" (an EULA-style flow, no submit/confirm/etc next
// to it) now goes ungated — the same class of false negative documented
// above, just one word wider.
const IRREVERSIBLE = /\b(submit|apply|pay|buy|purchase|order|checkout|confirm|delete|remove|send|book|sign up)\b/i;

export type Mode = "watch" | "normal" | "trust";

// watch mode's whole rule: every mutating tool asks, every read is free.
// Mirrors the tool list mcp.ts registers — the 4 reads (snapshot, tabs,
// hover, scroll) are simply everything not in this set.
const MUTATING = new Set(["click", "type", "key", "select", "upload", "navigate", "use_tab", "back", "forward"]);

// watch-mode approval memory: once a tool kind is approved, stop asking for
// the rest of the task — without this, watch asks on every keystroke and is
// unusable. normal never touches this set; see check() below.
// ponytail: keyed on tool name alone, not (tool, origin) as the ideal would
// be — labels (the only page state gate.ts keeps) comes from serialize()
// text and never carries an origin, and getting one means a new round trip
// to the panel. Add per-origin scoping if a task that hops origins mid-run
// turns out to need it.
let approvedTools = new Set<string>();

/**
 * Record that the human approved this kind of interaction, so watch mode
 * stops asking for it. Call this ONLY after an approval — a denial must
 * never reach here, or the next denial-worthy action would sail through
 * unasked. `args` is unused today (approvals key on tool name alone, see
 * the ponytail note above) but kept in the signature so per-origin scoping
 * can start using it later without changing the call site.
 */
export function rememberApproval(name: string, args?: Record<string, unknown>): void {
  void args;
  approvedTools.add(name);
}

// Clear the approval memory. Call at the start of every new task — one run's
// "yes, always" answers must not leak into the next.
export function resetApprovals(): void {
  approvedTools = new Set();
}

// watch-mode prompt text for a mutating call, once no gate-worthy label is
// available to quote (either the tool has no ref, or the ref's label is
// unremarkable) — plain and honest rather than borrowing normal mode's
// "reads as irreversible" framing, which does not apply here.
function describe(name: string, args: Record<string, unknown>): string {
  const ref = typeof args.ref === "string" ? args.ref : undefined;
  const label = ref && labels.get(ref);
  if (label) return `${name} ${ref} ${label}`;
  switch (name) {
    case "click":
      return ref ? `click ${ref}` : "click";
    case "type":
      return ref ? `type into ${ref}` : "type";
    case "select":
      return ref ? `choose an option in ${ref}` : "select";
    case "upload":
      return "upload a file";
    case "key":
      return `press ${args.name}`;
    case "navigate":
      return `navigate to ${args.url}`;
    case "use_tab":
      return typeof args.url === "string" ? `open a new tab at ${args.url}` : "switch tabs";
    case "back":
      return "go back";
    case "forward":
      return "go forward";
    default:
      return name;
  }
}

/**
 * Does this tool call need a human? Depends on the mode the panel set for
 * this task — the model never sees or sets `mode`, only the bridge passes
 * it through from the panel:
 *   - "trust": never. Always returns null.
 *   - "watch": every mutating tool asks, once per tool kind per task (see
 *     rememberApproval above); the 4 read tools never do.
 *   - "normal": today's behaviour, unchanged — `click`, when its ref
 *     resolves to a label that reads as irreversible, and `key: Enter`,
 *     when the current page carries ANY irreversible-labelled control (see
 *     below).
 * "normal" is also the fallback: an undefined, missing, or unrecognised
 * mode string runs this branch, never "trust" — a bad mode value must fail
 * closed, not open.
 *
 * Returns a one-line description for the approval prompt, or null to let it
 * run.
 */
export function check(name: string, args: Record<string, unknown>, mode?: Mode): string | null {
  if (mode === "trust") return null;

  if (mode === "watch") {
    if (!MUTATING.has(name)) return null;
    if (approvedTools.has(name)) return null;
    return describe(name, args);
  }

  // "normal", and the fallback for anything that isn't exactly "watch" or
  // "trust" — deliberately the same branch below, unchanged from before mode
  // existed.
  if (name === "key" && args.name === "Enter") {
    // key: Enter bypasses a ref-based gate entirely — a focused form submits
    // on Enter with no click, and the bridge cannot see what has focus, so it
    // cannot narrow this the way click narrows by ref. The fallback: gate
    // Enter whenever the page carries ANY irreversible-labelled control at
    // all. A job application page has "Submit Application" on it and gates;
    // a Google search box page matches nothing in IRREVERSIBLE and stays
    // silent, so ordinary search flows are not degraded. False positives
    // cost one dismiss; false negatives are the bypass we cannot accept.
    // ponytail: page-level heuristic, not focus tracking — the known ceiling
    // is a page that mixes a submit button with an unrelated search box,
    // which over-gates. Add real focus tracking if that turns out to matter.
    for (const [ref, label] of labels) {
      if (IRREVERSIBLE.test(label)) return `press Enter — this page has ${ref} ${label}`;
    }
    return null;
  }

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
