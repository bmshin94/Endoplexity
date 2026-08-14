/**
 * The session list, as data.
 *
 * A transcript used to die three ways: Chrome tears the side panel document
 * down on every window switch, the bridge's session map is in memory, and
 * there was no way to start something clean without losing what came before.
 * This is the storage side of the fix — the panel keeps `sessions` in
 * chrome.storage.local, newest first, and sessions[0] is always the live one.
 *
 * DOM-free on purpose, same reason md.js and math.js are: it makes the caps and
 * the truncation testable from the bridge's suite without a browser.
 */

export const MAX_SESSIONS = 20;
// A run can be hundreds of tool calls; the tail is the part worth keeping.
export const MAX_ENTRIES = 400;
// Tool results are whole page snapshots — up to 300 AX lines each. Stored
// whole, twenty sessions of them would sail past the 10MB quota and every
// write would start failing silently.
export const MAX_FIELD = 2000;

export const fresh = (now = Date.now()) => ({ at: now, entries: [] });

/** What the history list calls it: the first thing you actually typed. */
export function titleOf(session) {
  const entries = session?.entries ?? [];
  // The live slot before anything is typed into it. "Untitled task" would be a
  // lie about a session that has not started, and it sits at the top of the list.
  if (!entries.length) return "New session";
  const text = String(entries.find((entry) => entry.k === "user")?.text ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "Untitled task";
  return text.length > 64 ? `${text.slice(0, 63)}…` : text;
}

// A tool row's `args` is an OBJECT, so a string-only clip skipped it entirely
// and one `type` call carrying a pasted cover letter went to storage whole —
// which is exactly the unbounded growth MAX_FIELD exists to prevent. Recursing
// keeps the shape restore() expects and clips the strings inside it.
const cut = (value) => {
  if (typeof value === "string") {
    return value.length > MAX_FIELD
      ? `${value.slice(0, MAX_FIELD)}\n… (truncated — the full text was in the run)`
      : value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cut);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, cut(inner)]));
};

/** The storable form: the tail of the entries, with the long strings clipped. */
export const pack = (entries) =>
  entries.slice(-MAX_ENTRIES).map((entry) =>
    Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, cut(value)])),
  );

/**
 * Start a fresh session. A live session with nothing in it already IS one, so
 * pressing New twice does not push an empty transcript into the history.
 */
export function startNew(sessions, now = Date.now()) {
  if (!sessions?.length) return [fresh(now)];
  if (!sessions[0].entries?.length) return sessions;
  return [fresh(now), ...sessions].slice(0, MAX_SESSIONS);
}
