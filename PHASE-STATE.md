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
`chrome://extensions` → Load unpacked → `extension/`, open the side panel, paste the token
once, type a task, hit Run. Panel console: `comet.selftest()`, `comet.measure()`.
See `docs/handrun.md`.

---

## Done

- **P0 — scaffold + authenticated handshake.** Loopback HTTP+WS, token file bootstrap,
  upgrade gated on extension origin AND timing-safe token. Verified: curl 401/401/401/101
  across the four origin+token combinations, `netstat` showing no 0.0.0.0 bind.

- **P1 — CDP tool layer.** `chrome.debugger` flat auto-attach, one session per OOPIF,
  `snapshot`/`click`/`type`/`key`, generation-based stale refs. Verified 2026-07-31: live
  `comet.selftest()` **7/7**, including a trusted click inside a real out-of-process iframe.
  Fixtures serve a `127.0.0.1` host page iframing a `localhost` form — a real OOPIF, offline.

- **P2 — MCP server + Claude adapter.** Streamable HTTP at `/mcp`, calls relayed over the
  existing WS, `claude -p` spawned with `--mcp-config` pointing back at the bridge. Verified
  2026-08-01: `comet.task("search google for cats, open the first result")` ran unattended
  end to end. curl on `/mcp`: 401/401/401/200, same gate shape as the WS upgrade.

- **P3 — token efficiency + panel UI.** Snapshots default to actionable + headings
  (`full: true` restores prose, cap 300); `navigate`/`click`/`key` return the page they
  produced while `type` stays a cheap ack; one ToolSearch call loads all five tools; panel
  gained the task box, Run/Stop and a cost line. Verified 2026-08-03: `npm test` 20/20,
  `selftest()` **7/7**, one clean unattended google run at **$0.0984 / 111,872 tokens /
  9 turns**, containing a **single** snapshot — the P2 design would have fired ~5 more.
  "Well under half of P2" is **unmeasurable, not passed**: no P2 cost was ever recorded.
  Record the number next time. Prose-cutting alone was **1.5x, not 2x** — lines halved,
  tokens did not, because the actionable lines that survive are the long ones.

- **P4 — approval gate.** `bridge/src/gate.ts` is the policy and the only place that decides:
  `remember()` builds a ref → label map from the page text the bridge is **already relaying**
  (`@f0e38 [button] "Submit Application"` is right there — no extra round trip, no panel say
  in it), `check()` gates `click` only, on a word-boundary label match. `relay.ts` carries it
  — `askPanel`/`settleGate`, own id sequence; 60s silence denies, no panel denies, a panel
  that drops mid-gate denies. `mcp.ts`'s `relay()` is the single chokepoint, so the gate
  cannot end up half-wired across five handlers. `index.ts` also swallows a fake-XML run and
  respawns once. Verified live 2026-08-03 on the OOPIF fixture: **approve** → the page's own
  "submitted after 36 keydowns" ($0.0438 / 8 turns), **deny** → the agent stopped and
  reported instead of routing around ($0.0347 / 7 turns). `npm test` **26/26**, and the gate
  tests build their input from the real `serialize()` so an ax.js format drift fails the test
  instead of silently disabling the gate.

## Current phase: 5 — Cursor adapter + model picker

Done when the same task runs on Grok 4.5 and Composer 2.5 through `cursor-agent -p`.
`cursor-agent` is **not installed yet**: install it and confirm Windows support BEFORE
writing code against it (`docs/specs/design.md:121`). If Windows support turns out to be
missing, Claude-only still ships everything through P6 and the panel hides the option.
`mcp.ts` must stay CLI-agnostic — it already is, which is what makes this phase small.

## Carried forward — still open

- **`key: Enter` bypasses the gate.** A focused form submits on Enter with no click, and the
  bridge cannot see what has focus. Deliberately out of P4's scope ("submit-labelled click"),
  and P6's done-when already says gated submit — solve it there against real sites.

- **Stale refs are the top cost sink**, ahead of snapshot bloat: 4 of the 9 turns in the P3
  closing run went to `click` → stale → `snapshot` → `click` → "isn't navigating" → gave up
  and navigated directly. A live google SERP keeps mutating after `settle()` returns, so a
  ref can be dead the moment it is handed out. Whether the second click failed for the same
  reason or hit the new-tab gotcha is undiagnosed — needs one instrumented run.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
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
- **The gate reads labels off the page text it is already relaying**, rather than asking the
  panel what a ref points at. The bridge sees every snapshot on its way back to the model,
  so the label is free; a `describe` round trip would have been a second protocol for
  information already in hand. Cost: it depends on ax.js's line format, which is why the
  gate test builds its input from the real `serialize()`
- **Mouse to the element's own session, keyboard to the main session.** Measured, not
  assumed: the same submit does nothing at translated root coords `104,362` on the main
  session and submits at frame coords `79,197` on the frame's own. Events sent to the tab's
  main session are hit-tested by the root renderer and never cross into an OOPIF, so no
  coordinate translation exists anywhere. Keyboard follows focus, which the browser routes
- **Actions return the page they produced.** A separate `snapshot` call is a whole model
  turn, and a turn re-sends everything. `type` is the deliberate exception
- **No build step yet** — plain HTML/JS extension. Add Vite + React only if a phase needs it
- P0: **origin-ID pinning skipped deliberately.** The token already stops every realistic
  attacker; pinning adds a knob whose only failure mode is a silent refusal when the
  unpacked folder moves. Revisit only if this is ever packed and distributed

## Gotchas

- **Never rotate `.comet-token` without asking.** It appearing in a chat transcript is not
  a leak worth breaking a configured panel over.
- Auto-attach also hands you **workers and service workers** — register `type === "iframe"`
  only, or every snapshot carries `(frame unavailable)` noise and a worker shutting down
  invalidates every ref.
- Pin the ref generation for a whole snapshot; reading the live counter per ref marks early
  frames stale while blessing later ones.
- Only one debugger per tab: the tab under test must not have its own devtools open.
- **Never assume the active tab is drivable.** `chrome://*`, the web store and other
  extensions reject both `chrome.debugger` and `tabs.update`, and the panel is usually
  opened from one of them. Cost a live run in P2 and a self-test run in P3 — anything that
  needs a tab goes through `attach()`'s picker, never `tabs.query({active:true})`.
- **A click that opens a new tab returns the old page.** `settle()` watches the attached tab
  only. Not a regression, but P6/P7 will hit it.
- **Token cost is a design constraint, not a chore.** Every tool return crosses the model's
  context on every subsequent turn. Anything added to a tool's output is paid for
  repeatedly, by both CLIs. Measure a task's cost before and after any tool change.
- A check that asserts on one exact string can't tell "never happened" from "happened
  wrong" — both read as absent. Report what the page actually said.
- **Actions return the page, so anything that breaks rendering reads as a broken action.**
  One bad node threw out of `serialize()` and the agent concluded the browser itself was
  failing, retried, "reset" by navigating away, and burned the run — the click had actually
  worked. Snapshot rendering must never throw on page data: no AX field is a guaranteed
  string. Cheap tell in the log: an action fails but the page underneath it did change.
- Running a second bridge to smoke-test rewrites `.comet-mcp.json` to that port
  (`writeMcpConfig` runs before `listen`). Restart the real one afterwards.

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- CLIs spawn with **`--tools "ToolSearch"`**, an allowlist, plus
  `--allowedTools "ToolSearch,mcp__comet__*" --strict-mcp-config --setting-sources ""`.
  A denylist is not enough and was measured failing: with `--disallowedTools Bash Edit Write
  Read` the agent's init event still listed `PowerShell`, `Task`, `Skill`, `WebFetch` and
  `NotebookEdit`. `--tools ""` is wrong too — MCP tools arrive **deferred** and ToolSearch
  is the only way to reach them. ToolSearch must be in `--allowedTools` as well: without it
  print mode leaves it visible but uncallable and the model emits fake XML tool calls as text
- `--setting-sources ""` is worth real money, not just safety: with the operator's hooks and
  CLAUDE.md loaded, a one-tool task billed 33k tokens of preamble and $0.41 instead of $0.02
- `/mcp` requires the token and **refuses any request carrying an `Origin`**: only a CLI we
  spawned should reach it, and a CLI never sends one
- The token never goes in argv (process lists are world-readable) — it lives in
  `.comet-mcp.json`, mode 0600, gitignored
- No `--dangerously-skip-permissions`, and never `--bare` (it forces `ANTHROPIC_API_KEY`
  auth, defeating the point of running on a subscription)
