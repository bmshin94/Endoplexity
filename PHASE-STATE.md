# CometClone — phase state

**Goal: replicate Perplexity Comet's browser-control feature**, driven by existing Claude Max
and Cursor subscriptions instead of metered API keys. Design doc: `docs/specs/design.md`.
Job-applying is a *test scenario*, never the product — judge features by "does Comet do this
on any site", not "does this finish the job-form task".

**Shape:** Chrome side panel (MV3) → local Node bridge → `claude -p` / `cursor-agent -p`.
The bridge exposes browser tools over MCP; the CLIs are the agent loop. The extension never
talks to a model, the CLI never talks to Chrome.

**Run:** `npm install` · `npm start` (prints the token) · `npm test` · `npm run cursor-login`
(once, for the Cursor models — never `cursor-agent login`). Then `chrome://extensions` → Load
unpacked → `extension/`, open the side panel, paste the token, type a task, hit Run; **Reply**
continues the last conversation instead of starting a new one. Panel console:
`comet.selftest("C:\path\to\file.pdf")`, `comet.measure()`, `comet.reply("…")`. Uploads read
`.comet-files.json` (copy `.comet-files.example.json`). See `docs/handrun.md`.

## Done

- **P0–P2 — handshake, CDP tool layer, MCP relay.** Loopback WS gated on extension origin AND
  timing-safe token (curl 401/401/401/101); flat auto-attach, one CDP session per OOPIF,
  generation-based stale refs, 7/7 incl. a trusted click in a real cross-site OOPIF; `/mcp`
  relayed over that same socket, and a google search+open ran unattended.
- **P3 — token efficiency.** Snapshots default to actionable + headings; actions return the
  page they produced. One google run at **$0.0984 / 111,872 tokens / 9 turns**. Prose-cutting
  alone was **1.5x, not 2x** — the surviving actionable lines are the long ones.
- **P4 — approval gate.** `gate.ts` is the policy and the only place that decides; `relay()`
  is the single chokepoint so it cannot be half-wired. 60s silence, no panel, or a panel
  dropping mid-gate all deny. Approve and deny both verified live.
- **P5 — Cursor adapter + model picker.** `cursor-agent` native Windows, no WSL, in a
  bridge-owned profile; model → adapter off an allowlist map. Ran end to end on `composer-2.5`
  and `cursor-grok-4.5-medium`. Shell denied, `apiKeySource: "login"`.
- **Session continuity (2026-08-04).** The bridge keeps the CLI session id and `--resume`s it;
  the panel gains **Reply**, live only when the last run left a transcript. Verified live on
  *both* CLIs by codeword recall across two separate spawns ($0.0075 on claude), and the
  resumed claude run's init still lists only `ToolSearch` + `mcp__comet__*` — resume restores
  the conversation, not reach.

## Current phase: 6 — v1, form-fill hardening — **STILL OPEN**

Built and unit-verified (`npm test` **51/51**, `comet.selftest()` **13/13** incl. upload and
select against the OOPIF fixture):

- **`upload(file, match?)`** takes a configured KEY, never a path, and scans every frame's DOM
  for `input[type=file]` rather than taking a ref: real ATS forms hide the input entirely.
- **`select(ref, value)`** — native `<select>` via `Runtime.callFunctionOn` + bubbling
  `input`/`change`. Near-useless on real ATS forms (see gotchas) — click+click is the path.
- **`key: Enter` gated** on any irreversible-labelled control, and **stale refs return the
  fresh page** with the error, so recovery costs no turn.

**Verified live on the real Cloudflare Greenhouse form (2026-08-04) by driving `/mcp` with
curl — no model in the loop:** `upload` found **both** hidden file inputs (`resume`,
`cover_letter`) that the AX tree shows only as "Attach" buttons, `match:"cover"` hitting the
second; and **the gate intercepted a real "Submit application" click**, denying on the 60s
timeout so it never reached Chrome.

**NOT verified — why the phase is not closed:**
- **The agent has never completed the task.** Both live runs failed: one stopped to ask for
  applicant data, one emitted fake `<function_calls>` XML. Every tool result above came from
  driving MCP by hand. **Done-when says "'Apply with my resume' completes on 3 real job sites"
  — that has not happened once.** Session continuity removes the *first* failure mode; the
  next live run tests whether that was enough.
- **Only 1 site, not 3** (user scoped to Cloudflare 2026-08-04); Lever and Ashby untested, and
  multi-page untested since the Cloudflare form is single-page.

## Carried forward — still open

- **Stale refs are still the top cost sink** — P6 made the error carry the fresh page, never
  exercised live.
- **Panel profile field is over-fitted to job applications** — generic prompt-context in a
  job-shaped costume. Generalise (a "what Comet knows about me" store, per the user's
  Obsidian-folder idea) or drop it.
- **The agent's markdown still renders raw** (`**bold**`) into a `<pre>`: replying is now
  possible, reading the question comfortably is not.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
| 6 | **v1 — form-fill hardening** | *(open)* "Apply with my resume" completes **agent-driven**, incl. upload + multi-page + gated submit |
| — | **Refinement** | Grounded in what Comet actually does: memory, panel UX, cost |
| 7 | Multi-tab research | "Compare these 5 laptops" → table in panel |

## Decisions locked

- **Side panel + local bridge**, not a Chromium fork; **`chrome.debugger` from the extension**,
  not external CDP, so it uses the already-logged-in profile; **the panel owns the WebSocket
  and CDP**, not the service worker, which dodges MV3 idle teardown
- **Auto-run, gate irreversible actions** — the gate lives in the bridge, never in a prompt,
  and **reads labels off the page text it already relays** rather than asking the panel what a
  ref points at. Cost: it depends on ax.js's line format, hence the gate test using the real
  `serialize()`
- **Mouse to the element's own session, keyboard to the main session.** Measured: the same
  submit does nothing at translated root coords on the main session and submits at frame coords
  on the frame's own — events sent to the main session are hit-tested by the root renderer and
  never cross into an OOPIF, so no coordinate translation exists anywhere
- **Actions return the page they produced.** A separate `snapshot` is a whole model turn, and a
  turn re-sends everything. `type` is the deliberate exception
- **`upload` takes a configured key and no ref.** `DOM.setFileInputFiles` runs in the browser
  process and can read anything, so a model-chosen path is exfiltration; and the real input is
  hidden and absent from the AX tree (measured on Greenhouse — only "Attach" buttons show)
- **Session state is in memory and dies with the bridge** — resuming across a restart would
  resume into a Chrome that has moved on, with every ref in that transcript already stale. A
  reply also pins the model: a claude transcript cannot be handed to cursor-agent
- **The Cursor CLI runs in a bridge-owned profile, pinned by two env vars, not one.**
  `CURSOR_CONFIG_DIR` covers `cli-config.json` and the session; `mcp.json` resolves off
  `homedir()`, so HOME/USERPROFILE are pinned too. Cursor has no `--tools`, so the boundary is
  `permissions.deny` in a config file the bridge owns
- **Spawn `node.exe index.js`, never the `cursor-agent` shim** — node cannot spawn a `.cmd`
  without `shell: true`, which would re-parse the user's prompt on a command line
- **No build step yet** — plain HTML/JS extension. Add Vite + React only if a phase needs it

## Gotchas

- **Never rotate `.comet-token` or `.comet-files.json` without asking.**
- **Both CLIs report the session id as `session_id`**, cursor included, despite its flag being
  spelled `--resume [chatId]`. `index.ts` reads three spellings as cheap insurance.
- **A fresh claude run's init lists only `["ToolSearch"]`** — MCP tools show up in a later or
  resumed run's init, so "no comet tools in init" is NOT proof of a broken run, which weakens
  it as the fake-`<function_calls>` diagnostic.
- **cursor can end a turn with `result: ""`** when the model left its answer in `thinking`
  deltas and emitted no assistant text (composer-2.5). The panel renders with `||`, not `??` —
  an empty string is not nullish and printed a blank line.
- **Real ATS dropdowns are not `<select>`.** Greenhouse/Lever/Ashby use an `<input>` plus a
  flyout listbox, so `select` refuses them: `click` the combobox → options appear in the AX
  tree with refs → `click` the option. Greenhouse's country flyout returns **307 lines** and
  hits the 300-line cap, so type into it to filter first.
- **A successful upload hands back a page that looks like it failed.** React re-renders the
  attach UI after `settle()`'s 300ms, so Greenhouse still read "No file chosen" right after the
  file landed. The return line says "succeeded" first for exactly this reason.
- **The fake-`<function_calls>` retry only looked at the `result` event** and so never fired on
  a run whose final message was clean. Now latched across all events. ~$0.06 a miss.
- Auto-attach also hands you **workers and service workers** — register `type === "iframe"`.
  Pin the ref generation for a whole snapshot, or early frames read stale and later ones don't.
  Only one debugger per tab: the tab under test must not have devtools open.
- **Never assume the active tab is drivable.** `chrome://*` and the web store reject both
  `chrome.debugger` and `tabs.update` — always go through `attach()`'s picker.
- **A click that opens a new tab returns the old page.** `settle()` watches the attached tab.
- **Token cost is a design constraint.** Every tool return crosses the model's context on every
  later turn. Measure a task's cost before and after any tool change.
- **Actions return the page, so anything that breaks rendering reads as a broken action.**
  Rendering must never throw on page data: no AX field is a guaranteed string.
- Running a second bridge to smoke-test rewrites **both** `.comet-mcp.json` and
  `~/.comet-cursor/home/.cursor/mcp.json` to that port. Back both up, or restart the real one.
- Greenhouse runs an **invisible reCAPTCHA enterprise** iframe — expect it on real submits.
- Cursor's model ids are not the design doc's: `cursor-grok-4.5-{low,medium,high}`, each with a
  `-fast` twin; `--list-models` needs login and is the source of truth. Its stream-json is
  claude-shaped but not identical — tool calls are their own `type: "tool_call"` event and
  `usage` is **camelCase**, so reading one spelling prints a 60k-token run as 0.
- Piping a native command through `Select-Object -First N` in PowerShell closes the pipe and
  kills the child. It killed a `cursor-agent login` mid-OAuth and read as a failed login.

## Security invariants (do not regress)

- Bind `127.0.0.1` only; both origin **and** token required on WS upgrade
- **`upload` resolves a key, never a model-supplied path** — `files.ts` rejects relative paths
  and unknown keys; the model never sees a filesystem path at all
- **`--resume` restores a conversation, not a permission set.** Every restriction flag is
  passed again on a resumed spawn. Verified 2026-08-04 by reading a resumed run's init event —
  `ToolSearch` + `mcp__comet__*` and nothing else — not by reading docs
- The Cursor CLI has **no tool flags at all** — its boundary is `permissions.deny` (`Shell(*)`,
  `Write(*)`, `Read(*)`, `WebFetch(*)`) plus `allow: ["Mcp(comet:*)"]`, and it only holds while
  HOME is pinned. Verified by running a shell call, not by reading docs
- claude spawns with **`--tools "ToolSearch"`** (an allowlist — a denylist was measured failing)
  plus `--allowedTools "ToolSearch,mcp__comet__*" --strict-mcp-config --setting-sources ""`.
  `--tools ""` is wrong too: MCP tools arrive **deferred**, ToolSearch is the only way to reach
  them, and it must be in `--allowedTools`. `--setting-sources ""` is worth real money — with
  the operator's hooks and CLAUDE.md loaded, a one-tool task billed 33k tokens of preamble and
  $0.41 instead of $0.02
- `/mcp` requires the token and **refuses any request carrying an `Origin`**. Re-verified
  2026-08-04: 401/401/401/200
- The token never goes in argv — it lives in `.comet-mcp.json`, mode 0600, gitignored
- No `--dangerously-skip-permissions`, and never `--bare` (it forces `ANTHROPIC_API_KEY`)
