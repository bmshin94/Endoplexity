# Verifying it by hand

Tasks have a panel UI as of Phase 3 — type one in the box and hit **Run**, watch
the steps land in the log, **Stop** kills the agent. The `comet` object stays on
the panel's own devtools console because that is still the only way to reach the
CDP layer directly.

## The check

`npm start`, reload the CometClone card on `chrome://extensions`, open the side
panel, right-click inside it → **Inspect**, and paste:

```js
await comet.selftest(); await comet.measure()
```

`selftest()` is the tool gate; `measure()` is the Phase 3 one — it snapshots a
real page the way Phase 2 serialized it and the way it does now, and prints the
ratio. No agent run, so it costs nothing.

It navigates the active tab to the OOPIF fixture itself and prints PASS/FAIL per
check. Nothing to open, nothing to compare by eye. The fixture is now a two-step
form, so the checks click **Continue** partway through, then exercise a native
dropdown (incl. an option whose markup has stray whitespace, and a nonsense value
that must fail with the option list in the error) and the file-upload path (incl.
a page with no file input at all).

Pass a path to also exercise the upload happy path — the panel can't fabricate a
file on disk, so without one that single check prints as `SKIP`, distinct from
and not counted against PASS/FAIL:

```js
await comet.selftest("C:\\path\\to\\some.pdf")
```

The fixture (`bridge/test/fixtures/`) serves its form from `localhost` while the
host page comes from `127.0.0.1` — different sites to Chrome, so the frame gets
its own renderer exactly like a Greenhouse, Lever or Workday embed. That makes
the trap reproducible offline instead of hostage to someone's careers page.

The tab under test must not have its own devtools open — only one debugger can
attach at a time. The panel's inspector is a different target, so it is fine.

## Driving it by hand

```js
await comet.attach();                          // a drivable tab, or attach(tabId)
comet.state();                                 // attached frames + live ref count
console.log(await comet.snapshot());           // @f0e1 [button] "…", refs per frame
console.log(await comet.snapshot({full:true})); // …plus body text
await comet.type("@f1e1", "Ada");
console.log(await comet.click("@f1e4"));       // returns the page it produced
console.log(await comet.key("Enter"));         // so does this
```

Refs are `@f<frame>e<n>` and die on the next `snapshot()` or any navigation —
including the snapshot `click` and `key` take on their way out, so always act on
the refs from the page the last action handed back.

Snapshots list actionable elements only. Body text costs the agent on every turn
after it is read, so reading tasks pass `full: true` rather than everything
paying for it by default.

## Applying with a resume

The panel has a collapsed **Profile** section above the task box — paste name,
email, phone, location, work authorisation, whatever the forms keep asking for.
It's stored in `chrome.storage.local`, so it survives reloads, and gets appended
(clearly delimited) to whatever prompt you send, so "apply with my resume" doesn't
need those details typed out per task. The panel log only ever shows the prompt
you typed, never the profile — it's personal data and the log is what ends up
pasted into bug reports.

The resume itself uploads by KEY, never a path — the model only ever sees a
name like `resume` in the tool description, never a filesystem path (it runs in
the browser process, which can read anything you can). A repo-root
`.comet-files.json` is the one place a key becomes an absolute path, and it's
a human-edited allow-list, never anything the model writes:

```json
{ "resume": "C:\\Users\\you\\Documents\\resume.pdf" }
```

Copy `.comet-files.example.json` to get started. Not committed — it points at a
real path on your machine.

## On a real job site

Same calls, real page. Only one URL shape exercises the OOPIF path:

- `job-boards.greenhouse.io/<company>/jobs/<id>` — Greenhouse is the **top**
  frame. Fine for the tools, does not test OOPIF.
- a careers page embedding `boards.greenhouse.io/embed/job_app?…` in an iframe —
  the real trap, and what `selftest()` reproduces offline.

Don't submit an application you don't mean to send; the approval gate that stops
that lands in Phase 4.
