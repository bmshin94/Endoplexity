# Verifying the CDP tools (Phase 1)

No model and no panel UI yet — Phase 2 wires MCP, Phase 3 builds the UI. Until
then the tools live on `comet` in the side panel's own devtools console.

## The check

`npm start`, reload the CometClone card on `chrome://extensions`, open the side
panel, right-click inside it → **Inspect**, and paste:

```js
await comet.selftest()
```

It navigates the active tab to the OOPIF fixture itself and prints PASS/FAIL per
check. Nothing to open, nothing to compare by eye.

```
PASS  OOPIF auto-attach
PASS  form fields found in the snapshot
PASS  fields live in a child frame, not f0
PASS  trusted keystrokes reached the cross-origin form
PASS  typed values landed
PASS  unknown ref rejected
PASS  refs go stale on navigation
```

The fixture (`bridge/test/fixtures/`) serves its form from `localhost` while the
host page comes from `127.0.0.1` — different sites to Chrome, so the frame gets
its own renderer exactly like a Greenhouse, Lever or Workday embed. That makes
the trap reproducible offline instead of hostage to someone's careers page.

The tab under test must not have its own devtools open — only one debugger can
attach at a time. The panel's inspector is a different target, so it is fine.

## Driving it by hand

```js
await comet.attach();                    // active tab, or attach(tabId)
comet.state();                           // attached frames + live ref count
console.log(await comet.snapshot());     // @f0e1 [button] "…", refs per frame
await comet.type("@f1e1", "Ada");
await comet.click("@f1e4");
await comet.key("Enter");
```

Refs are `@f<frame>e<n>` and die on the next `snapshot()` or any navigation.

## On a real job site

Same calls, real page. Only one URL shape exercises the OOPIF path:

- `job-boards.greenhouse.io/<company>/jobs/<id>` — Greenhouse is the **top**
  frame. Fine for the tools, does not test OOPIF.
- a careers page embedding `boards.greenhouse.io/embed/job_app?…` in an iframe —
  the real trap, and what `selftest()` reproduces offline.

Don't submit an application you don't mean to send; the approval gate that stops
that lands in Phase 4.
