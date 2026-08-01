# CometClone — phase state

Agentic browser control (Comet clone) driven by **existing Claude Max and Cursor
subscriptions** instead of metered API keys. Design doc: `docs/specs/design.md`.

**Shape:** Chrome side panel (MV3) → local Node bridge → `claude -p` / `cursor-agent -p`.
The bridge exposes browser tools over MCP; the CLIs are the agent loop. The extension
never talks to a model, the CLI never talks to Chrome.

## Run it

```bash
npm install
npm start                    # prints the token
npm test
```
Then `chrome://extensions` → Developer mode → Load unpacked → `extension/`, open the
side panel, paste the token once. Verify with `await comet.selftest()` in the panel's
devtools console — see `docs/handrun.md`.

---

## Done

- **P0 — scaffold + authenticated handshake.** Loopback HTTP+WS server, token file
  bootstrap, upgrade gated on extension origin AND timing-safe token. Verified: 4/4
  tests, curl showing 401/401/401/101 across the four origin+token combinations,
  `netstat` confirming no 0.0.0.0 bind, live panel `ping`→`pong` in 11ms.

- **P1 — CDP tool layer.** Drives the page from `panel.js` via `chrome.debugger`, no model
  involved. Verified 2026-07-31: `npm test` 8/8 and a live `comet.selftest()` **7/7**,
  including a trusted click landing inside a real out-of-process iframe.

**Built**
- `extension/cdp.js` — attach + flat auto-attach (`Target.setAutoAttach{autoAttach,flatten}`),
  one CDP session per OOPIF, `snapshot` / `click` / `type` / `key`, generation-based stale refs
- `extension/ax.js` — AX tree → indented text, refs on actionable roles (`@f1e7`),
  duplicate StaticText dropped, 1000-line cap
- `extension/selftest.js` — the whole phase gate as one call, `await comet.selftest()`
- `bridge/test/fixtures/` + a fixture route in `bridge/src/index.ts` — host page on
  `127.0.0.1` iframing a form on `localhost`, i.e. a real out-of-process frame offline
- `bridge/test/ax.test.ts` — 4 tests; `docs/handrun.md` — how to run it

**Verified (run, not assumed)**
- `npm test` → 8/8; live `comet.selftest()` → **7/7**
- Fixture routes via curl → `200 text/html` both pages, `404` for `/fixtures/../../package.json`
  and unknown paths; `http://localhost:8787` does reach the 127.0.0.1-only bind
- `chrome.debugger` flat sessions confirmed against Chrome docs: `DebuggerSession.sessionId`
  requires **Chrome 125+**, `onEvent` source carries it

**The OOPIF click bug, settled.** The first gate run was 6/7: a click on a button inside
the cross-origin frame did nothing. Diagnosed by running the same submit three ways
against the fixture rather than by reasoning about it:

| dispatch | coords | result |
|---|---|---|
| main session | translated to root, `104,362` | nothing |
| **frame's own session** | **frame-local, `79,197`** | **submitted** |
| `requestSubmit()`, no click | — | submitted |

So mouse events sent to the tab's main session are hit-tested by the root renderer
alone and never cross into an out-of-process iframe — the coordinates were never the
problem, and an OOPIF box model needs no translation, just the matching session. The
offset-walk written first (`DOM.getFrameOwner` + parent box models, Playwright's
approach) was deleted rather than kept as a fallback. `type`/`key` stay on the main
session: keyboard follows focus, which the browser does route into the OOPIF.

A real Greenhouse form has not been touched yet — the fixture is the only evidence.

---

## Current: Phase 2 — MCP server + Claude adapter

Bridge serves Streamable HTTP at `/mcp`, relays each tool call over the existing WS to
the panel, spawns `claude -p` with `--mcp-config` pointing back at itself.

**Done when:** `claude -p "search google for X, open the first result"` completes unattended.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
| 3 | Panel UI + live step streaming | Steps render as they happen; Stop kills the child process |
| 4 | Approval gate | Submit-labelled click blocks in the **bridge**; approve/stop/60s-timeout-deny |
| 5 | Cursor adapter + model picker | Same task on Grok 4.5 and Composer 2.5 |
| 6 | **v1 — form-fill hardening** | "Apply with my resume" on **3 real job sites**, incl. upload + multi-page + gated submit |
| 7 | Multi-tab research | "Compare these 5 laptops" → table in panel |

Phase 6 is the ship line.

---

## Decisions locked

- **Side panel + local bridge**, not a Chromium fork and not a separate web UI
- **`chrome.debugger` from the extension**, not external CDP — no `--remote-debugging-port`
  relaunch, uses the already-logged-in profile
- **Panel owns the WebSocket and CDP**, not the service worker — full API access, dodges
  MV3 idle teardown
- **Auto-run, gate irreversible actions** — gate lives in the bridge, never in a prompt
- **Mouse to the element's own session, keyboard to the main session.** Measured, not
  assumed — see the P1 table above. No coordinate translation anywhere
- **No panel UI for tools until P3** — the console is the hand-run surface
- **No build step yet** — plain HTML/JS extension. Add Vite + React only if P3 needs it
- P0: **origin-ID pinning skipped deliberately.** The token already stops every realistic
  attacker; pinning adds a config knob whose only failure mode is a silent refusal when the
  unpacked folder moves. Revisit only if this is ever packed and distributed.

## Gotchas

- **Never rotate `.comet-token` without asking.** It appearing in a chat transcript is not
  a leak worth breaking a configured panel over.
- Auto-attach also hands you **workers and service workers** — register `type === "iframe"`
  only, or every snapshot on a real site carries `(frame unavailable)` noise and a worker
  shutting down invalidates every ref.
- Pin the ref generation for a whole snapshot; reading the live counter per ref marks early
  frames stale while blessing later ones.
- `.comet-token` is written `mode: 0o600` but Windows shows `-rw-r--r--` — POSIX modes are
  ignored, ACLs govern. Low risk on a single-user machine.
- Only one debugger per tab: the tab under test must not have its own devtools open.
- A check that asserts on one exact string can't tell "never happened" from "happened
  wrong" — both read as absent. The P1 submit check burned a session on that; it now
  reports what the page actually said.

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- CLIs spawn with `--allowedTools "mcp__comet__*" --disallowedTools Bash Edit Write Read` —
  otherwise "fill this form" has a shell behind it
- No `--dangerously-skip-permissions`
