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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("no active tab");

  if (cdp.state().tabId !== tab.id) await cdp.attach(tab.id);
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
  await cdp.click(submit);

  // The fixture writes its result into the DOM, so a second snapshot reads it
  // back — no extra tool needed.
  snap = await cdp.snapshot();
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

  const reloaded = cdp.loaded(tab.id);
  await chrome.tabs.reload(tab.id);
  await reloaded;
  check("refs go stale on navigation", await throws(() => cdp.click(submit), "stale ref"));

  return report(results);
}

function report(results) {
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed}/${results.length} FAILED` : `\nall ${results.length} passed`);
  return failed === 0;
}
