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

## Current: Phase 1 — CDP tool layer ✅ code complete (2026-07-31)

Drives the page from `panel.js` via `chrome.debugger`. No model involved.

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
- `npm test` → 8/8 pass
- Fixture routes via curl → `200 text/html` both pages, `404` for `/fixtures/../../package.json`
  and unknown paths; `http://localhost:8787` does reach the 127.0.0.1-only bind
- `chrome.debugger` flat sessions confirmed against Chrome docs: `DebuggerSession.sessionId`
  requires **Chrome 125+**, `onEvent` source carries it

**Live gate run: 6/7 PASS, one real bug.** PASS on OOPIF auto-attach, fields found,
fields in a child frame not f0, typed values landed, unknown ref rejected, refs go
stale on navigation. FAIL on `trusted keystrokes reached the cross-origin form`.

**The bug — OOPIF click coordinates are frame-relative, not root-viewport.**
`click @f1e4 at 79,197`, but the iframe does not start until y≈250 in the host page,
so no element inside it can be at root y=197. 197 is where the submit button sits in
the *frame's own* space (16px body margin + three label/input pairs). So the click
landed on the host page's paragraph and the form never submitted. `type` passed
because `DOM.focus` takes a backendNodeId and needs no coordinates — only the
coordinate path is broken. Assumption recorded under Decisions was wrong.

**Fix next session**, in order of preference:
1. Dispatch `Input.*` to the **element's own session** instead of MAIN, so the
   coordinates and the widget receiving them share one space. Confirm CDP allows
   the Input domain on an iframe target first — if it does this is a one-line fix.
2. Otherwise walk up the frame chain adding offsets: `DOM.getFrameOwner({frameId})`
   in the parent session → `DOM.getBoxModel` on that iframe element → add to the
   child's coordinates, recursing for nested frames. This is what Playwright does.

Then re-run `await comet.selftest()` — one paste, expects 7/7. A real Greenhouse
form has not been touched yet.

---

## Next: Phase 2 — MCP server + Claude adapter

Bridge serves Streamable HTTP at `/mcp`, relays each tool call over the existing WS to
the panel, spawns `claude -p` with `--mcp-config` pointing back at itself.

**Done when:** `claude -p "search google for X, open the first result"` completes unattended.

Start by running `comet.selftest()` — Phase 2 is built on tools whose live behaviour is
still unconfirmed.

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
- ~~Input always dispatched to the main session; OOPIF box models come back in
  root-viewport coordinates~~ — **disproven by the P1 self-test, see the bug above.**
  They are frame-relative and need either a frame-local dispatch or offset maths
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

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- CLIs spawn with `--allowedTools "mcp__comet__*" --disallowedTools Bash Edit Write Read` —
  otherwise "fill this form" has a shell behind it
- No `--dangerously-skip-permissions`
