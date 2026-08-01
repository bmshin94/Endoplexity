// One paste, one verdict. `await comet.selftest()` in the side panel console
// drives the whole Phase 1 gate: it navigates the tab to the OOPIF fixture,
// snapshots, fills the cross-origin form, clicks, and checks that refs go stale.
// Nothing to set up and nothing to eyeball.

import * as cdp from "./cdp.js";

const FIXTURE = "http://127.0.0.1:8787/fixtures/host.html";
const FIELDS = [
  ["First name", "Ada"],
  ["Last name", "Lovelace"],
  ["Email", "ada@example.com"],
];
const KEYSTROKES = FIELDS.reduce((n, [, v]) => n + v.length, 0);

const refFor = (text, role, name) => text.match(new RegExp(`(@\\w+) \\[${role}\\] "${name}"`))?.[1];

async function throws(fn, needle) {
  try {
    await fn();
    return `no error, expected "${needle}"`;
  } catch (err) {
    return err.message.includes(needle) ? null : `got "${err.message}"`;
  }
}

export async function selftest() {
  const results = [];
  const check = (label, detail) => results.push({ ok: !detail, label, detail: detail ?? "" });

  // Not the active tab. The panel is normally opened from chrome://extensions,
  // which is closed to chrome.debugger, so the self-test died on "Cannot access
  // a chrome:// URL" before testing anything. attach() already knows how to pick
  // a drivable tab — the same trap that cost Phase 2 a whole live run.
  if (cdp.state().tabId === null) await cdp.attach();
  const tabId = cdp.state().tabId;
  await cdp.navigate(FIXTURE);

  let snap = await cdp.snapshot();
  const frames = cdp.state().frames;
  check(
    "OOPIF auto-attach",
    frames.some((f) => f.url.includes("/fixtures/form.html")) ? null : `frames: ${JSON.stringify(frames)}`,
  );

  const submit = refFor(snap, "button", "Submit Application");
  const refs = FIELDS.map(([label]) => refFor(snap, "textbox", label));
  check("form fields found in the snapshot", refs.every(Boolean) ? null : `got ${refs}`);
  check(
    "fields live in a child frame, not f0",
    refs.every((r) => r && !r.startsWith("@f0")) ? null : `refs ${refs} came from the main frame`,
  );
  if (!submit || !refs.every(Boolean)) return report(results);

  for (const [i, [, value]] of FIELDS.entries()) await cdp.type(refs[i], value);

  // click hands back the page it produced, so the old follow-up snapshot is gone
  // — that saved turn is the whole point of Phase 3. `full` because the fixture
  // reports itself in body text, which the lean default drops.
  snap = await cdp.click(submit, { full: true });
  // Report what the fixture actually said, not just that the expected string is
  // missing — "never submitted" and "submitted, miscounted" are different bugs
  // and they used to fail identically.
  const reported = snap.match(/submitted after \d+ keydowns/)?.[0];
  check(
    "trusted keystrokes reached the cross-origin form",
    reported === `submitted after ${KEYSTROKES} keydowns`
      ? null
      : (reported ?? "the form never submitted at all"),
  );
  check("typed values landed", FIELDS.every(([, v]) => snap.includes(v)) ? null : "a value is missing");

  check("unknown ref rejected", await throws(() => cdp.click("@f9e9"), "unknown ref"));

  const reloaded = cdp.loaded(tabId);
  await chrome.tabs.reload(tabId);
  await reloaded;
  check("refs go stale on navigation", await throws(() => cdp.click(submit), "stale ref"));

  return report(results);
}

/**
 * Phase 3's number, on a real page and without spending an agent run.
 *
 * Serializes the same tree twice: once the way Phase 2 did (all prose, 1000-line
 * cap) and once the way it ships now. This is the term that dominates a task —
 * a snapshot is not paid once, it sits in the context and is re-sent on every
 * later turn, so cutting it compounds.
 *
 * Conservative on purpose: the 2-space -> 1-space indent change is not undone in
 * the "before" leg, so the real saving is a little larger than this prints.
 */
export async function measure(url = "https://www.google.com/search?q=cats") {
  if (cdp.state().tabId === null) await cdp.attach();
  await cdp.navigate(url);

  const before = await cdp.snapshot({ full: true, maxLines: 1000 });
  const after = await cdp.snapshot();
  // ~4 chars per token. Wrong in the third digit, right for a ratio.
  const tokens = (s) => Math.round(s.length / 4);
  const lines = (s) => s.split("\n").length;

  console.log(
    `${url}\n` +
      `  phase 2  ${lines(before)} lines, ~${tokens(before)} tokens\n` +
      `  phase 3  ${lines(after)} lines, ~${tokens(after)} tokens\n` +
      `  per snapshot: ${(tokens(before) / Math.max(tokens(after), 1)).toFixed(1)}x smaller`,
  );
  return { before: tokens(before), after: tokens(after) };
}

function report(results) {
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed}/${results.length} FAILED` : `\nall ${results.length} passed`);
  return failed === 0;
}
