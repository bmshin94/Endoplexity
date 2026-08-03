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
npm run cursor-login         # once, for the Cursor models — never `cursor-agent login`
```
`chrome://extensions` → Load unpacked → `extension/`, open the side panel, paste the token
once, type a task, hit Run. Panel console: `comet.selftest()`, `comet.measure()`.
See `docs/handrun.md`.

---

## Done

- **P0 — scaffold + authenticated handshake.** Loopback HTTP+WS, token file bootstrap,
  upgrade gated on extension origin AND timing-safe token. Verified: curl 401/401/401/101
  across the four origin+token combos, `netstat` showing no 0.0.0.0 bind.

- **P1 — CDP tool layer.** `chrome.debugger` flat auto-attach, one session per OOPIF,
  `snapshot`/`click`/`type`/`key`, generation-based stale refs. Verified 2026-07-31:
  `comet.selftest()` **7/7**, incl. a trusted click in a real OOPIF (fixtures iframe
  `localhost` from `127.0.0.1` — a real cross-site frame, offline).

- **P2 — MCP server + Claude adapter.** Streamable HTTP at `/mcp`, calls relayed over the
  existing WS, `claude -p` spawned with `--mcp-config` pointing back at the bridge. Verified
  2026-08-01: a google search+open ran unattended end to end. curl on `/mcp`: 401/401/401/200.

- **P3 — token efficiency + panel UI.** Snapshots default to actionable + headings
  (`full: true` restores prose, cap 300); `navigate`/`click`/`key` return the page they
  produced, `type` stays a cheap ack; panel gained the task box, Run/Stop, cost line.
  Verified 2026-08-03: `npm test` 20/20, `selftest()` 7/7, one google run at **$0.0984 /
  111,872 tokens / 9 turns** with a **single** snapshot (P2 would have fired ~5 more).
  "Under half of P2" was **unmeasurable, not passed** — no P2 cost was ever recorded.
  Prose-cutting alone was **1.5x, not 2x**: lines halved, tokens did not, because the
  actionable lines that survive are the long ones.

- **P4 — approval gate.** `bridge/src/gate.ts` is the policy and the only place that decides:
  `remember()` builds ref → label from the page text the bridge **already relays**, `check()`
  gates `click` only, on a word-boundary label match. `relay.ts` carries it (`askPanel`/
  `settleGate`); 60s silence, no panel, or a panel dropping mid-gate all deny. `mcp.ts`'s
  `relay()` is the single chokepoint, so the gate cannot end up half-wired across five
  handlers. Verified live 2026-08-03 on the OOPIF fixture: **approve** → the page's own
  "submitted after 36 keydowns" ($0.0438 / 8 turns), **deny** → the agent stopped and
  reported rather than routing around ($0.0347 / 7 turns). `npm test` **26/26**; the gate
  tests build their input from the real `serialize()`, so ax.js format drift fails a test
  instead of silently disabling the gate.

- **P5 — Cursor adapter + model picker.** `cursor-agent` 2026.07.23, **native Windows, no
  WSL**. `bridge/src/cursor.ts` spawns it in a bridge-owned profile, `index.ts` routes
  model → adapter off an allowlist map (the string reaches an argv), panel has the picker,
  `mcp.ts` untouched. Verified live 2026-08-03: the same task ran end to end on **both**
  `composer-2.5` (9.96s) and `cursor-grok-4.5-medium` (10.0s) — `getMcpTools(comet)` →
  `comet-navigate` → "Example Domain", `done code 0`, and **neither called `snapshot`
  after**, so the P3 briefing transfers to a second CLI. Security measured, not read off
  the docs: `whoami` denied **and** the model's own `powershell -Command "whoami"` retry
  denied; `mcp list` under the spawn's env returns `comet: ready` and nothing else, all 5
  tools resolving through the token URL; `apiKeySource: "login"`, so it runs on the
  subscription. `npm test` **33/33**.

## Current phase: 6 — v1, form-fill hardening

Done when "Apply with my resume" completes on **3 real job sites**, including upload,
multi-page and gated submit. This is the ship line. The two carried-forward items below
both come due here.

## Carried forward — still open

- **Mid-conversation model switching is not built.** `docs/specs/design.md:138` lists it in
  P5's done-when; the table here never did, and P5 closed on the table. Every task is a
  fresh spawn — no `--resume`, no stored session id, so "now do the same on the next
  posting" starts cold. Both CLIs support `--resume`; wire it when a phase actually needs
  continuity, which is P6's multi-page flows.

- **`key: Enter` bypasses the gate.** A focused form submits on Enter with no click, and the
  bridge cannot see what has focus. Deliberately out of P4's scope ("submit-labelled click"),
  and P6's done-when already says gated submit — solve it there against real sites.

- **Stale refs are the top cost sink**, ahead of snapshot bloat: 4 of the 9 turns in the P3
  closing run went to `click` → stale → `snapshot` → `click` → gave up and navigated
  directly. A live google SERP keeps mutating after `settle()` returns, so a ref can be dead
  the moment it is handed out. Whether the second click failed for that reason or hit the
  new-tab gotcha is undiagnosed — needs one instrumented run.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
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
- **The gate reads labels off the page text it is already relaying**, not by asking the panel
  what a ref points at — the bridge sees every snapshot on its way back, so the label is
  free. Cost: it depends on ax.js's line format, hence the gate test using real `serialize()`
- **Mouse to the element's own session, keyboard to the main session.** Measured: the same
  submit does nothing at translated root coords `104,362` on the main session and submits at
  frame coords `79,197` on the frame's own. Events sent to the main session are hit-tested by
  the root renderer and never cross into an OOPIF, so no coordinate translation exists
  anywhere. Keyboard follows focus, which the browser routes
- **Actions return the page they produced.** A separate `snapshot` is a whole model turn, and
  a turn re-sends everything. `type` is the deliberate exception
- **The Cursor CLI runs in a bridge-owned profile, pinned by two env vars, not one.**
  `CURSOR_CONFIG_DIR` covers `cli-config.json`, the session and chat history; `mcp.json`
  resolves off `homedir()` instead, so `HOME`/`USERPROFILE` are pinned at
  `~/.comet-cursor/home` as well. This is the `--strict-mcp-config --setting-sources ""`
  equivalent, and it is what makes the tool restriction possible at all — cursor has no
  `--tools`/`--allowedTools`, so the boundary is `permissions.deny` in a config file the
  bridge owns. Deliberately NOT `--force`/`--yolo`, which is "run everything"
- **Spawn `node.exe index.js`, never the `cursor-agent` shim.** The Windows install is a
  `.cmd` → `.ps1` → node chain, and node cannot spawn a `.cmd` without `shell: true` —
  which would hand the user's prompt to a command line to be re-parsed. The `.ps1` only
  picks the newest version directory, which is four lines to repeat
- **No build step yet** — plain HTML/JS extension. Add Vite + React only if a phase needs it
- P0: **origin-ID pinning skipped deliberately.** The token already stops every realistic
  attacker; pinning's only failure mode is a silent refusal when the unpacked folder moves.
  Revisit only if this is ever packed and distributed

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
  extensions reject both `chrome.debugger` and `tabs.update`, and the panel is usually opened
  from one. Cost a live run in P2 and a self-test in P3 — anything needing a tab goes through
  `attach()`'s picker, never `tabs.query({active:true})`.
- **A click that opens a new tab returns the old page.** `settle()` watches the attached tab
  only. Not a regression, but P6/P7 will hit it.
- **Token cost is a design constraint, not a chore.** Every tool return crosses the model's
  context on every later turn, so anything added to a tool's output is paid for repeatedly by
  both CLIs. Measure a task's cost before and after any tool change.
- A check asserting on one exact string can't tell "never happened" from "happened wrong" —
  both read as absent. Report what the page actually said.
- **Actions return the page, so anything that breaks rendering reads as a broken action.**
  One bad node threw out of `serialize()`; the agent concluded the browser was failing,
  retried, "reset" by navigating away and burned the run — the click had worked. Rendering
  must never throw on page data: no AX field is a guaranteed string. Cheap tell in the log:
  an action fails but the page underneath it did change.
- Running a second bridge to smoke-test rewrites `.comet-mcp.json` to that port
  (`writeMcpConfig` runs before `listen`). Restart the real one afterwards.
- **`CURSOR_CONFIG_DIR` alone is not isolation, and it fails silently in the worse
  direction.** Set only that and the agent loads the operator's `~/.cursor/mcp.json`:
  measured 27 tools across 7 servers (firecrawl incl. its own browser automation,
  `security_recon`, stripe/supabase/vercel plugin auth) with **comet absent** — more
  reach than the claude path and none of the tools it needs. Pin HOME too.
- Cursor's model ids are not the ones in `docs/specs/design.md:118`. There is no
  `grok-4.5`; it is `cursor-grok-4.5-{low,medium,high}`, each with a `-fast` twin.
  `composer-2.5` is real. `--list-models` is the source of truth, and needs login.
- Cursor's stream-json is claude-shaped but not identical: tool calls are their own
  `type: "tool_call"` event keyed by tool kind (`shellToolCall`), there are undocumented
  `thinking` events, and `usage` is **camelCase** (`inputTokens`) — read one spelling only
  and a 60k-token run prints as 0.
- Piping a native command through `Select-Object -First N` in PowerShell closes the
  pipe and kills the child. It killed a `cursor-agent login` mid-OAuth and read as
  exit 255 / a failed login when the login had actually gone through.

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- The Cursor CLI has **no tool flags at all** — its boundary is `permissions.deny`
  (`Shell(*)`, `Write(*)`, `Read(*)`, `WebFetch(*)`) plus `allow: ["Mcp(comet:*)"]` in a
  bridge-owned `cli-config.json`, and it only holds while HOME is pinned. Verified by
  running a shell call, not by reading the docs — `-p` is documented as having "access to
  all tools, including write and shell"
- claude spawns with **`--tools "ToolSearch"`**, an allowlist, plus
  `--allowedTools "ToolSearch,mcp__comet__*" --strict-mcp-config --setting-sources ""`.
  A denylist is not enough and was measured failing: with `--disallowedTools Bash Edit Write
  Read` the init event still listed `PowerShell`, `Task`, `Skill`, `WebFetch`, `NotebookEdit`.
  `--tools ""` is wrong too — MCP tools arrive **deferred**, ToolSearch is the only way to
  reach them, and it must be in `--allowedTools` or print mode leaves it visible but
  uncallable and the model emits fake XML tool calls as text
- `--setting-sources ""` is worth real money, not just safety: with the operator's hooks and
  CLAUDE.md loaded, a one-tool task billed 33k tokens of preamble and $0.41 instead of $0.02
- `/mcp` requires the token and **refuses any request carrying an `Origin`**: only a CLI we
  spawned should reach it, and a CLI never sends one
- The token never goes in argv (process lists are world-readable) — it lives in
  `.comet-mcp.json`, mode 0600, gitignored
- No `--dangerously-skip-permissions`, and never `--bare` (it forces `ANTHROPIC_API_KEY`
  auth, defeating the point of running on a subscription)
