// The hands. Drives the active tab over chrome.debugger — no model involved.
//
// Two things here are load-bearing and were built first on purpose:
//
//  1. Flat auto-attach. Greenhouse, Lever and Workday put their forms in
//     cross-origin iframes, which are separate renderer targets. The main
//     frame's AX tree contains nothing for them, so every OOPIF gets its own
//     CDP session and its own slice of the snapshot, with refs namespaced per
//     frame (@f1e7). Retrofitting this would mean rewriting the ref system.
//  2. Refs die. Every snapshot mints a new generation; navigation bumps it.
//     Acting on an old ref fails loudly instead of clicking whatever inherited
//     that backend node id — the single most common failure mode in every
//     agentic-browser clone surveyed.
//
// Requires Chrome 125+, where chrome.debugger.sendCommand accepts a sessionId.

import { serialize } from "./ax.js";

const MAIN = ""; // the tab's own session — sendCommand target with no sessionId

let tabId = null;
let sessions = new Map(); // sessionId -> { tag, url }
let refs = new Map(); // "@f0e3" -> { sessionId, backendNodeId, generation }
let generation = 0;
let frameSeq = 0;

const send = (sessionId, method, params = {}) =>
  chrome.debugger.sendCommand(sessionId ? { tabId, sessionId } : { tabId }, method, params);

function reset() {
  tabId = null;
  sessions = new Map();
  refs = new Map();
  frameSeq = 0;
}

// Bumped without clearing refs, so a ref minted before the page moved is still
// found and can be reported as stale rather than as unknown.
function invalidate(why) {
  generation++;
  console.log(`comet: refs invalidated (${why})`);
}

function setupSession(sessionId) {
  // Nested OOPIFs: each new session needs its own auto-attach or a frame two
  // levels deep never attaches.
  // ponytail: waitForDebuggerOnStart stays false, so a target that appears and
  // navigates in the same tick can be missed. Snapshot is on demand and can
  // just be re-run. Flip it (plus Runtime.runIfWaitingForDebugger) only if a
  // frame turns out to be reliably absent.
  send(sessionId, "Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  }).catch((err) => console.warn(`comet: setAutoAttach failed on ${sessionId || "main"}`, err));
  send(sessionId, "Page.enable").catch(() => {});
}

function onEvent(source, method, params) {
  if (source.tabId !== tabId) return;

  if (method === "Target.attachedToTarget") {
    const { sessionId, targetInfo } = params;
    // Auto-attach also hands us workers and service workers. They have no
    // accessibility tree, so registering them would put a permanent
    // "(frame unavailable)" line in every snapshot of any real site.
    if (targetInfo.type !== "iframe") return;
    sessions.set(sessionId, { tag: `f${++frameSeq}`, url: targetInfo.url });
    console.log(`comet: frame f${frameSeq} attached — ${targetInfo.url}`);
    setupSession(sessionId);
  }

  if (method === "Target.detachedFromTarget") {
    // Only frames we actually track, or a worker shutting down would nuke every
    // ref on the page for no reason.
    if (sessions.delete(params.sessionId)) invalidate("frame detached");
  }

  // Only a session's own root frame; sub-frame navigations inside one document
  // do not move the nodes we hold.
  if (method === "Page.frameNavigated" && !params.frame.parentId) {
    const frame = sessions.get(source.sessionId ?? MAIN);
    if (frame) frame.url = params.frame.url;
    invalidate("navigation");
  }
}

// chrome://, the web store and other extensions are closed to chrome.debugger AND
// to tabs.update, so a tab showing one is a dead end, not a starting point.
const DRIVABLE = /^(https?|file):/;

/**
 * The tab to drive when nobody named one.
 *
 * The active tab is the obvious guess and the wrong one often enough to matter:
 * the panel is normally opened from chrome://extensions, which fails every tool
 * with "Cannot access a chrome:// URL" and cannot even be navigated away from.
 * Fall back to another drivable tab in the window, and open one if there is none.
 */
async function pickTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const usable = tabs.find((t) => t.active && DRIVABLE.test(t.url ?? "")) ?? tabs.find((t) => DRIVABLE.test(t.url ?? ""));
  if (usable) return usable.id;
  // No wait: about:blank is already loaded, and navigate() waits for its own.
  const opened = await chrome.tabs.create({ url: "about:blank", active: true });
  return opened.id;
}

/** Attach to a tab (defaults to a drivable one) and wire up OOPIF discovery. */
export async function attach(target) {
  if (tabId !== null) throw new Error(`already attached to tab ${tabId} — detach() first`);

  const id = target ?? (await pickTab());
  if (id == null) throw new Error("no tab to drive");

  await chrome.debugger.attach({ tabId: id }, "1.3");
  tabId = id;
  sessions.set(MAIN, { tag: "f0", url: "" });
  invalidate("attached");
  setupSession(MAIN);

  const tab = await chrome.tabs.get(id);
  console.log(`comet: attached to tab ${id} — ${tab.url}`);
  return id;
}

/**
 * Resolves when the tab finishes loading. Attach the listener BEFORE navigating.
 * With a timeout it also resolves on giving up — a page holding one analytics
 * beacon open never reaches `complete`, and a listener left behind would fire on
 * every tab update for the life of the panel.
 */
export function loaded(id, timeoutMs) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(done);
      resolve();
    };
    const done = (updated, info) => {
      if (updated === id && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(done);
    if (timeoutMs) setTimeout(finish, timeoutMs);
  });
}

/** Point the attached tab at a URL and wait for the load to finish. */
export async function navigate(url) {
  requireAttached();
  // Listener first: a cached page can finish loading before we would hear it.
  const ready = loaded(tabId);
  await chrome.tabs.update(tabId, { url });
  await ready;
  console.log(`comet: navigated to ${url}`);
  return `navigated to ${url}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Let the page finish reacting before it gets read.
 *
 * The fixed 300ms covers the common case, a handler that mutates the DOM without
 * navigating — there is no event for "React finished rendering". If the action
 * did start a load, wait for that instead, but capped: a page holding one
 * analytics beacon open stays `loading` indefinitely, and the tool call has its
 * own 30s deadline in the relay that a hang here would burn.
 */
async function settle() {
  await sleep(300);
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "loading") await loaded(tabId, 10_000);
}

export async function detach() {
  if (tabId === null) return;
  const id = tabId;
  reset();
  await chrome.debugger.detach({ tabId: id });
  console.log(`comet: detached from tab ${id}`);
}

/**
 * Read the page. Returns indented text with a ref on everything actionable;
 * refs are valid only until the next snapshot or navigation.
 */
export async function snapshot(options) {
  requireAttached();
  // Pinned for the whole read: if a frame navigates midway, invalidate() bumps
  // the counter past this and EVERY ref from this snapshot reads as stale.
  // Reading the live counter per ref would mark only the early frames stale and
  // silently bless the rest.
  const gen = ++generation;
  refs = new Map();

  const out = [];
  for (const [sessionId, frame] of sessions) {
    // A frame that auto-attached before it had navigated was recorded with an
    // empty URL, and Page.frameNavigated cannot repair it: inside an OOPIF's own
    // session that event still carries a parentId, so the handler above skips it.
    // ponytail: ask once, only when unknown — no cost on the steady-state path,
    // and a frame that later renavigates keeps a stale but non-empty label, which
    // is orientation for the model rather than correctness.
    if (!frame.url) {
      const info = await send(sessionId, "Target.getTargetInfo").catch(() => null);
      frame.url = info?.targetInfo?.url ?? "";
    }
    if (frame.tag !== "f0") out.push(`\n--- frame ${frame.tag} — ${frame.url}`);
    try {
      await send(sessionId, "Accessibility.enable");
      const { nodes } = await send(sessionId, "Accessibility.getFullAXTree");
      const { text, refs: frameRefs } = serialize(nodes, frame.tag, options);
      for (const [ref, backendNodeId] of frameRefs) {
        refs.set(ref, { sessionId, backendNodeId, generation: gen });
      }
      out.push(text);
    } catch (err) {
      // Frames come and go mid-snapshot; one dead frame must not kill the read.
      out.push(`(frame ${frame.tag} unavailable: ${err.message})`);
    }
  }
  return out.join("\n");
}

function requireAttached() {
  if (tabId === null) throw new Error("not attached — call attach() first");
}

function resolve(ref) {
  requireAttached();
  const hit = refs.get(ref);
  if (!hit) throw new Error(`unknown ref ${ref} — call snapshot() first`);
  if (hit.generation !== generation) {
    throw new Error(`stale ref ${ref} — the page changed, call snapshot() again`);
  }
  return hit;
}

/** Centre of a ref in its own frame's coordinates, scrolled into view first. */
async function centreOf(ref) {
  const { sessionId, backendNodeId } = resolve(ref);
  await send(sessionId, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
  const { model } = await send(sessionId, "DOM.getBoxModel", { backendNodeId });
  const [x1, y1, x2, y2, x3, y3, x4, y4] = model.content;
  return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 };
}

/**
 * Click at the element's centre with a real mouse event, dispatched to the
 * element's OWN session so the coordinates and the widget receiving them share
 * one space.
 *
 * Mouse events sent to the tab's main session are hit-tested by the root
 * renderer alone and never cross into an out-of-process iframe. Measured on the
 * fixture: the same submit button does nothing at translated root coords
 * 104,362 on MAIN, and submits at frame coords 79,197 on the frame's session.
 * So an OOPIF box model needs no translation — just the matching session.
 *
 * Keyboard is the opposite and stays on MAIN: key events follow focus, and the
 * browser routes those into the focused OOPIF widget for us.
 *
 * Returns the page as it looks afterwards. A click is the one action that
 * reliably changes what the agent needs to see next, and asking for that
 * separately cost a whole model turn — which re-sends the entire conversation,
 * not just the snapshot. Phase 2 spent six of them on one search.
 */
export async function click(ref, options) {
  const { sessionId } = resolve(ref);
  const { x, y } = await centreOf(ref);
  const base = { x, y, button: "left", clickCount: 1 };
  await send(sessionId, "Input.dispatchMouseEvent", { ...base, type: "mouseMoved", buttons: 0 });
  await send(sessionId, "Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
  await send(sessionId, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
  console.log(`comet: click ${ref} at ${Math.round(x)},${Math.round(y)}`);
  await settle();
  return snapshot(options);
}

/**
 * Type into a ref, one trusted keystroke per character, so React's onChange and
 * every autocomplete widget that listens for keydown actually fire.
 */
export async function type(ref, text) {
  const { sessionId, backendNodeId } = resolve(ref);
  await send(sessionId, "DOM.focus", { backendNodeId });
  // ponytail: per-char, no batching. Design doc's ceiling is ~200 chars before
  // Input.insertText is worth it; nothing typed into a form field is near that.
  for (const ch of text) {
    // Alphanumerics carry their US-layout key code, which is what handlers that
    // sniff event.keyCode expect. Everything else goes through as text only —
    // a full layout table is not worth 200 lines here.
    const windowsVirtualKeyCode = /[a-z0-9]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : 0;
    const base = { text: ch, unmodifiedText: ch, key: ch, windowsVirtualKeyCode };
    await send(MAIN, "Input.dispatchKeyEvent", { ...base, type: "keyDown" });
    await send(MAIN, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  }
  console.log(`comet: typed ${text.length} chars into ${ref}`);
}

const KEYS = {
  Enter: { windowsVirtualKeyCode: 13, code: "Enter", key: "Enter", text: "\r" },
  Tab: { windowsVirtualKeyCode: 9, code: "Tab", key: "Tab" },
  Escape: { windowsVirtualKeyCode: 27, code: "Escape", key: "Escape" },
  Backspace: { windowsVirtualKeyCode: 8, code: "Backspace", key: "Backspace" },
  ArrowDown: { windowsVirtualKeyCode: 40, code: "ArrowDown", key: "ArrowDown" },
  ArrowUp: { windowsVirtualKeyCode: 38, code: "ArrowUp", key: "ArrowUp" },
};

/** Press a named key at whatever currently has focus. Returns the page after it. */
export async function key(name, options) {
  requireAttached();
  const spec = KEYS[name];
  if (!spec) throw new Error(`unknown key ${name} — have ${Object.keys(KEYS).join(", ")}`);
  const { text, ...rest } = spec; // text belongs on keyDown only, or Enter types twice
  await send(MAIN, "Input.dispatchKeyEvent", { ...rest, text, type: "keyDown" });
  await send(MAIN, "Input.dispatchKeyEvent", { ...rest, type: "keyUp" });
  console.log(`comet: key ${name}`);
  await settle();
  return snapshot(options);
}

/**
 * Set a file on a page's file input by filesystem path — no ref, deliberately.
 *
 * Job forms (Greenhouse, Lever, Ashby) hide <input type=file> behind a styled
 * button or dropzone, so the input is frequently missing from the AX tree
 * entirely — there is no ref to hand this on exactly the sites that matter.
 * DOM.setFileInputFiles works on a hidden input and fires a real change
 * event, which is what those forms listen for. No ref also means nothing
 * here can go stale.
 */
export async function upload(path, match, options) {
  requireAttached();
  const hits = [];
  for (const [sessionId, frame] of sessions) {
    try {
      const { root } = await send(sessionId, "DOM.getDocument", { depth: 0 });
      const { nodeIds } = await send(sessionId, "DOM.querySelectorAll", {
        nodeId: root.nodeId,
        selector: "input[type=file]",
      });
      for (const nodeId of nodeIds) {
        const { attributes } = await send(sessionId, "DOM.getAttributes", { nodeId });
        const attrs = {};
        for (let i = 0; i < attributes.length; i += 2) attrs[attributes[i]] = attributes[i + 1];
        hits.push({ sessionId, nodeId, label: attrs["aria-label"] ?? attrs.name ?? attrs.id ?? attrs.accept ?? "(unlabelled)" });
      }
    } catch (err) {
      // Frames come and go; one dead frame must not kill the whole operation.
      console.warn(`comet: upload scan skipped frame ${frame.tag}`, err);
    }
  }

  if (hits.length === 0) {
    throw new Error("no file input on this page — the upload control may be behind a button that has to be clicked first");
  }

  // Greenhouse's standard form carries a "Resume/CV" AND a "Cover Letter"
  // input, so first-wins on its own would make the second permanently
  // unreachable — and the "others:" line below would be reporting a choice
  // the model has no way to make.
  const wanted = match?.trim().toLowerCase();
  const pool = wanted ? hits.filter((h) => h.label.toLowerCase().includes(wanted)) : hits;
  if (!pool.length) {
    throw new Error(`no file input matching "${match}" — found: ${hits.map((h) => h.label).join(", ")}`);
  }

  const [chosen, ...rest] = pool;
  await send(chosen.sessionId, "DOM.setFileInputFiles", { files: [path], nodeId: chosen.nodeId });
  console.log(`comet: upload "${path}" -> input "${chosen.label}"`);
  await settle();
  const page = await snapshot(options);
  // "succeeded" said plainly, because the page below often contradicts it: a
  // React form re-renders its attach UI after settle()'s 300ms, so a Greenhouse
  // upload that worked hands back a page still reading "No file chosen".
  // Measured 2026-08-04. Without this line the agent reads its own success as a
  // failure and retries — the trap the whole "actions return the page" design
  // already walked into once.
  let prefix = `set "${path}" on file input "${chosen.label}" — succeeded; the page below may still show the old state for a moment`;
  if (rest.length) {
    prefix += ` (first of ${pool.length} — others: ${rest.map((h) => h.label).join(", ")}; pass match to pick one)`;
  }
  return `${prefix}\n${page}`;
}

/**
 * Runs INSIDE the page via Runtime.callFunctionOn (see select() below) — never
 * called locally, only stringified, so DOM globals here are fine unresolved.
 */
function pickOption(value) {
  // String(), not .toLowerCase() on the raw value: a ref can resolve to a node
  // with no tagName at all, and throwing in here surfaces as an exception the
  // caller reads as success — see select()'s exceptionDetails check.
  const tag = this.tagName;
  // Greenhouse, Lever and Ashby all use a custom combobox — an <input> plus a
  // flyout listbox — not a native <select>, so this is the COMMON case on real
  // ATS forms, not an edge case. click() drives those fine (the flyout's
  // options land in the AX tree with their own refs), so the error hands back
  // the recovery instead of just refusing.
  if (tag !== "SELECT") {
    return `error: not a <select> — got ${String(tag).toLowerCase()}. This is a custom combobox: click this ref to open its flyout, then click the option you want in the page that comes back. Typing into it first usually filters a long list.`;
  }
  const target = String(value).trim();
  const opts = [...this.options];
  let match = opts.find((o) => o.value === target);
  if (!match) match = opts.find((o) => o.text.trim() === target);
  if (!match) {
    const needle = target.toLowerCase();
    match = opts.find((o) => o.text.trim().toLowerCase().includes(needle));
  }
  if (!match) {
    const available = opts.map((o) => o.text.trim()).slice(0, 20).join(", ");
    return `error: no option matching "${target}" — available: ${available}`;
  }
  this.selectedIndex = match.index;
  // React listens for one, plain forms for the other — fire both.
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return match.text.trim();
}

/**
 * Choose an option in a native <select> by value or visible text.
 *
 * A native select's popup is rendered by the BROWSER, not the renderer, so
 * Input.dispatchMouseEvent — hit-tested by the renderer — can never land on
 * an option inside it. click() cannot drive a dropdown at all; this is the
 * only route: set selectedIndex directly from inside the page and fire the
 * events a dropdown listener actually waits for.
 */
export async function select(ref, value, options) {
  const { sessionId, backendNodeId } = resolve(ref);
  const { object } = await send(sessionId, "DOM.resolveNode", { backendNodeId });
  const { result, exceptionDetails } = await send(sessionId, "Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: pickOption.toString(),
    arguments: [{ value }],
    returnByValue: true,
  });

  // A throw inside the page leaves `result` holding the exception and `value`
  // undefined, which would otherwise read as success and hand back a page with
  // the dropdown silently unset — a required field left blank on a form the
  // agent then submits. Fail loudly instead.
  if (exceptionDetails) {
    throw new Error(`select failed inside the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }

  const outcome = result.value;
  if (typeof outcome === "string" && outcome.startsWith("error:")) {
    throw new Error(outcome.slice("error: ".length));
  }
  console.log(`comet: select ${ref} -> "${outcome}"`);
  await settle();
  return snapshot(options);
}

/** What is attached right now — for eyeballing state from the console. */
export const state = () => ({
  tabId,
  generation,
  frames: [...sessions.values()],
  refs: refs.size,
});

chrome.debugger.onEvent.addListener(onEvent);
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== tabId) return;
  console.warn(`comet: debugger detached (${reason})`);
  reset();
});
