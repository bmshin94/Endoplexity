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

- **P3 — token efficiency + panel UI.** Code complete 2026-08-01. **Live cost gate open.**

## Phase 3 — where it actually stands

**Built**
- `ax.js` — snapshot defaults to actionable + headings; `full: true` restores body prose;
  cap 1000 → 300 lines; 1-space indent
- `cdp.js` — `settle()` (300ms, then wait out a load, capped at 10s); `click`/`key` return
  the page they produced; `loaded()` takes a timeout and removes its own listener
- `tools.js` — `navigate`/`click`/`key` hand back the page; `type` stays a cheap ack, or a
  six-field form would cost six snapshots
- `claude.ts` — `--append-system-prompt`: one ToolSearch call for all five tools, no
  snapshot after an action, do not retry an action that already failed
- `panel.html`/`panel.js` — task box, Run/Stop, cost line on every result, log is the step
  stream; `selftest.js` gained `measure()`

**Verified (run, not assumed)**
- `npm test` → **19/19** (the old "16/16" was stale; commit 0dd3061 had added two)
- `/mcp` `tools/list` → 200, five tools, `snapshot` carries `full`
- ToolSearch round trips **4 → 1**, measured through the real `runClaude()` spawn against a
  panel-less bridge: 3 turns, `["ToolSearch","mcp__comet__navigate"]`, no fake XML, $0.0321
- Snapshot size on a live google SERP via `comet.measure()`: 404 lines/~3783 tokens →
  203 lines/~2445 tokens = **1.5x, not the 2x the plan assumed.** Lines halved, tokens did
  not: the actionable lines that survive are long, the dropped StaticText ones were short

**Open — this is what closes P3**
1. One clean `comet.task("go to google.com, search for cats, open the first result")` and
   its cost line. Prose-cutting alone does **not** reach "well under half" — the gate now
   rests on deleting 6 snapshot turns, and a turn re-sends the entire conversation.
2. `selftest()` back to **7/7**. Last live run was 6/7: OOPIF frame URL empty, because
   selftest now starts from `about:blank` so the iframe auto-attaches before it has a URL,
   and `Page.frameNavigated` cannot repair it (inside an OOPIF's own session that event
   still carries a `parentId`). Fixed by asking `Target.getTargetInfo` once when a frame's
   URL is unknown — **fix is untested live.**
3. **One unexplained run.** The agent emitted fake `<function_calls>` XML as text, 1 turn,
   zero real tool calls, then hallucinated an entire browser session. Not reproduced in
   three runs of the identical spawn path — same binary (2.1.170), same flags, briefing
   confirmed present by file mtime vs bridge start time. The bridge now prints the init
   event's `tools:` list untruncated, which settles it in one shot if it recurs.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
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
