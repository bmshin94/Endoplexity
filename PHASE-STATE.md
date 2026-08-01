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
side panel, paste the token once. In the panel's devtools console:
`await comet.selftest()` checks the tools, `comet.task("…")` runs an agent task.
See `docs/handrun.md`.

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

- **P2 — MCP server + Claude adapter.** Live gate passed 2026-08-01: `comet.task("go to
  google.com, search for cats, open the first result")` ran unattended, end to end,
  CLI → MCP → WS → CDP. See below for what it cost and why that is P3's problem.

## Phase 2 — MCP server + Claude adapter ✅

Bridge serves Streamable HTTP at `/mcp`, relays each tool call over the existing WS to
the panel, spawns `claude -p` with `--mcp-config` pointing back at itself.

**Done when:** `comet.task("search google for X, open the first result")` completes unattended.

**Built**
- `bridge/src/mcp.ts` — 5 tools (`snapshot` `navigate` `click` `type` `key`), stateless
  Streamable HTTP, a fresh server per request so concurrent calls cannot collide on ids
- `bridge/src/relay.ts` — id-correlated request/response over the existing WS, 30s timeout,
  in-flight calls rejected when the panel goes away
- `bridge/src/claude.ts` — spawn adapter, NDJSON via `readline`, writes `.comet-mcp.json`
- `extension/tools.js` — tool name → `cdp.*`, auto-attaches to the active tab on first use
- `extension/cdp.js` — added `navigate` + `loaded`; the self-test now shares them
- `comet.task("…")` / `comet.stop()` in the panel console; steps land in the panel log

**Verified (run, not assumed)**
- `npm test` → 16/16
- curl on `/mcp`: **401 / 401 / 401 / 200** for no-token, wrong-token, right-token-with-Origin,
  right-token — same shape as the WS gate. `tools/list` returns all 5 schemas
- A real `claude -p` through the adapter discovered and called `mcp__comet__snapshot`,
  got the relay's error back, and exited 0

**Two flag bugs found by running it, both fixed**
1. `--disallowedTools Bash Edit Write Read` (from the design doc) is a **denylist written
   POSIX-first**. The spawned agent's init event still listed `PowerShell`, `Task`, `Skill`,
   `WebFetch`, `NotebookEdit` — a shell behind "fill this form". Now `--tools "ToolSearch"`.
   `--tools ""` is wrong too: MCP tools arrive **deferred** and ToolSearch is the only way
   to reach them, so with `""` the agent sees no comet tools at all. Confirmed the boundary
   holds: `ToolSearch` on `select:Bash,PowerShell,Write,Read,Task` returns **0 tools**.
2. The spawned agent loaded the operator's **global hooks and CLAUDE.md** — 33k tokens of
   unrelated preamble, $0.41 for a one-tool task. `--setting-sources ""` → $0.02.

**The first live run failed on a precondition, not the pipeline.** `runTool` auto-attached
to `chrome.tabs.query({active:true})`, and the panel is normally opened from
`chrome://extensions` — closed to `chrome.debugger` AND to `tabs.update`, and impossible to
navigate away from. Attach threw, `tabId` stayed null, so every tool re-attached and failed
identically with `Cannot access a chrome:// URL`. Never reached CDP. `attach()` now prefers a
drivable `http(s)|file` tab, then any other in the window, then opens `about:blank`.

**It works and it is too expensive — that is P3's headline, not a footnote.**
One "search google for cats" run burned ~2% of a session on Sonnet. From the log:

| waste | count | why |
|---|---|---|
| `ToolSearch` round trips | 4 | MCP tools arrive **deferred**; each discovery is a whole model turn |
| full `snapshot` calls | 6 | one after every action, each up to the 1000-line AX cap — this is the bulk of it |
| dead recovery turns | 3 | Enter did not submit Google's box, clicked the button, gave up and used a `?q=` URL |

The snapshots dominate. Cheapest wins, in order: have `click`/`type`/`key` return the new
page state so a separate `snapshot` turn is not needed; default to actionable elements only
with the full tree behind a flag; drop the 1000-line cap hard. All of this lives in
`ax.js`/`mcp.ts`, i.e. **shared with the Cursor adapter** — fix it once, P5 inherits it.

Also unexplained: `snapshot` returned something the model called unrenderable on
`en.wikipedia.org/wiki/Cat`, twice. Reproduce before assuming it is cosmetic.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
| 3 | **Token efficiency** + panel UI + live step streaming | Same google task costs **well under half** what it does today, measured the same way; steps render as they happen; Stop kills the child process |
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
- **Never assume the active tab is drivable.** `chrome://*`, the web store and other
  extensions reject both `chrome.debugger` and `tabs.update`, and the panel is usually
  opened from one of them. Cost a whole live run.
- **Token cost is a design constraint, not a P3 chore.** Every tool return crosses the
  model's context on every subsequent turn. Anything added to a tool's output is paid for
  repeatedly, by both CLIs. Measure a task's cost before and after any tool change.
- A check that asserts on one exact string can't tell "never happened" from "happened
  wrong" — both read as absent. The P1 submit check burned a session on that; it now
  reports what the page actually said.

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- CLIs spawn with **`--tools "ToolSearch"`**, an allowlist, plus
  `--allowedTools "ToolSearch,mcp__comet__*" --strict-mcp-config --setting-sources ""`.
  A denylist is not enough and was measured failing — see P2 below.
  ToolSearch must be in `--allowedTools` too: without it, print mode leaves the
  tool visible but uncallable and the model emits fake XML tool calls as text.
- `/mcp` requires the token and **refuses any request carrying an `Origin`**: only a
  CLI we spawned should reach it, and a CLI never sends one
- The token never goes in argv (process lists are world-readable) — it lives in
  `.comet-mcp.json`, mode 0600, gitignored
- No `--dangerously-skip-permissions`, and never `--bare` (it forces
  `ANTHROPIC_API_KEY` auth, defeating the point of running on a subscription)
