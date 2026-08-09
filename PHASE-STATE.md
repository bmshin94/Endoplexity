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
  timing-safe token (401/401/401/101); flat auto-attach, one CDP session per OOPIF,
  generation-based stale refs; `/mcp` over that same socket; a google search+open ran unattended.
- **P3 — token efficiency.** Snapshots default to actionable + headings; actions return the
  page they produced. **Baseline: one google run at $0.0984 / 111,872 tokens / 9 turns.**
  Prose-cutting alone was **1.5x, not 2x** — the surviving actionable lines are the long ones.
- **P4 — approval gate.** `gate.ts` is the policy, `relay()` the single chokepoint. 60s silence,
  no panel, or a panel dropping mid-gate all deny. Approve and deny both verified live.
- **P5 — Cursor adapter + model picker**, end to end on `composer-2.5` and
  `cursor-grok-4.5-medium`; shell denied, `apiKeySource: "login"`.
- **Session continuity.** The bridge `--resume`s the CLI session id; the panel gains **Reply**,
  live only when the last run left a transcript. Verified by codeword recall across spawns.
- **Page context.** The panel names the current page in every task prompt, through the same
  picker `attach()` uses. Without it "apply to *this* job" was unanswerable — the agent asked
  for a URL and exited at 1 turn. Necessary but NOT sufficient: see the different-tab gotcha.
- **P6 — v1, agent-driven form fill (closed 2026-08-06).** `upload` takes a configured KEY and
  scans every frame's DOM for `input[type=file]` because real ATS forms hide it; `select`
  drives a native `<select>`; `key: Enter` is gated on irreversible-labelled controls; stale
  refs return the fresh page so recovery costs no turn. By curl on the real Cloudflare
  Greenhouse form, `upload` found **both** hidden inputs and **the gate intercepted a real
  "Submit application" click**. After the page-context fix **the agent drove that form
  unaided** — first agent-driven completion, user-confirmed. **Rescoped** from "3 real job
  sites": job-applying is the test case, not the product. **Not measured:** turns, cost, or
  whether stale-ref recovery and the combobox path fired — the ATS gotchas below are still
  unproven agent-driven.

- **P7 — reachability, 7 tools → 13 (closed 2026-08-06).** `scroll` (a real `mouseWheel`, so
  lazy content loads and an open flyout scrolls instead of the page behind it; optional ref
  scopes it), `hover` (`mouseMoved` at `centreOf`), `back`/`forward` (`Page.getNavigationHistory`
  + `navigateToHistoryEntry`), `tabs`/`use_tab` (list with the attached one starred, then
  switch by id or open a url), and `snapshot from:` — `serialize()` builds every line then
  slices, so the 300-line cap finally has a cursor. **Verified live: `selftest()` 27/27, 1
  skipped**, plus `npm test` 54/54 and all 13 tools listing over `/mcp` at HTTP 200. A form
  fill also ran agent-driven on the new tool layer, so P6's path still holds. **Closed
  without the cost number** — the gate below moved to P8 rather than blocking the phase.
  Corrected the phase's own premise on the way: the AX tree is the whole document, so below
  the fold was never unreachable.

## Current phase: 8 — multi-tab research

**Goal:** "Compare these 5 laptops" → a table in the panel. `tabs`/`use_tab` unblocked this;
what is untested is an agent holding several pages in mind at once without the context cost
running away.

**Done when:** a five-source comparison lands in the panel as a table, **and it is measured**
($ / tokens / turns).

**Shipped so far (2026-08-09), all unmeasured:**
- **`full` on `navigate` and `use_tab`.** cdp.js already forwarded an options bag to
  `snapshot`; only the tool schema was missing, so a *reading* task paid a whole extra model
  turn per source re-reading a page it had just been handed. Costs **~87 tokens/turn** of
  schema (all 13 tools now ~1,829, was 1,742), should save ~5 turns on a five-source read.
- **A fresh Run re-attaches to the active tab** (`panel.js` `runTask`). See the gotcha below —
  this is the bug that ate the first form-fill attempt.
- Self-test gained one check and is the **only** thing in the repo that exercises `tools.js`.
  Expect **28 passed, 1 skipped** (29/0 with a file path).

**Still owed — the numbers. Nothing has been measured yet.** Two runs, both against P3's
google baseline of **$0.0984 / 111,872 tokens / 9 turns**, procedure in `docs/handrun.md`
("The cost number"). Account for the ~1,829 tokens/turn of schema the baseline never paid
(~16k across 9 turns) rather than reading a rise as regression. The one attempt on
2026-08-09 was a **Reply, not a Run** — `$0.0967 / 142,756 / 11 turns` measures a
three-message conversation, not the task, and does not count. Multi-tab is where cost either
holds or doesn't: every tab switch returns a fresh page into a context that already holds
the last one.

## Carried forward — still open

- **Stale refs are still the top cost sink** — P6 made the error carry the fresh page, never
  exercised live.
- **Panel profile field is over-fitted to job applications** — generic prompt-context in a
  job-shaped costume. Generalise (a "what Comet knows about me" store, per the user's
  Obsidian-folder idea) or drop it.
- **The log is a `<pre>`, not a renderer.** `panel.js`'s `plain()` strips `**bold**` markers,
  so that specific eyesore is gone, but lists, headings and code fences still arrive as raw
  markdown. Deliberately not innerHTML — this text carries page content from arbitrary sites.
  Phase 9.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
| 9 | **Refinement build** | Frontend, permissions, smoothness, design, a real Obsidian-backed memory, and open-source/GitHub readiness. Deliberately its own phase — none of it belongs in 7 or 8 |

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
  turn re-sends everything. `type` is the deliberate exception — and so is `tabs`, which is
  orientation, not an action, and must not pay for a page the agent may not switch to
- **The two tools that ARRIVE somewhere (`navigate`, `use_tab`) also take `full`**, so a
  reading task gets the prose with the page. Acting tools deliberately do not: mid-form, body
  text is dead weight that every later turn re-sends
- **A fresh Run re-attaches to the active tab; a Reply never does.** "This page" can only mean
  the one you are looking at when you press Run, and a fresh Run holds no refs and no
  transcript, so re-binding is free. Mid-conversation it would destroy refs the agent is using
- **Scrolling is a real wheel event, not `window.scrollBy`.** Trusted, so an infinite feed's
  IntersectionObserver fires; hit-tested at a point, so a wheel over an open combobox scrolls
  the flyout rather than the document behind it. `scrollBy` does neither
- **Switching tabs is detach-then-attach, so every ref dies.** Only one debugger per tab and
  cdp.js tracks one — refs belong to the old renderer and would resolve to nothing. `use_tab`
  checks drivability BEFORE detaching, or a bad id costs the good attachment
- **Refs are minted during the AX walk, before the line window is cut.** So a ref only visible
  on a later `from:` page still resolves on the first, and re-reading renumbers nothing
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
- **"Nothing was filled" can mean the agent filled a DIFFERENT TAB.** `attach()` binds once
  and nothing re-bound it, so a panel left open kept driving whatever tab was active when it
  first attached. Measured 2026-08-09: attached to `about:blank`, user opened a Greenhouse
  posting in another tab, agent navigated *its own* tab there and filled the form perfectly —
  every tool returned success, every value landed, none of it on the page being watched.
  Fixed by re-attaching on a fresh Run, but the diagnostic habit matters more: **read
  `comet: attached to tab N — <url>` in the panel console before believing an action failed.**
  Naming the page (704e08c) does not catch this — the prompt said "about:blank" truthfully.
- **`navigate` waits for `complete` with NO timeout, deliberately** — unlike `go()` and
  `settle()`, which cap at 10s. Capping it was tried on 2026-08-09 and reverted unused: an
  early return hands back a half-loaded page that reads as fine and types into nothing, which
  is strictly worse than the relay's 30s deadline firing out loud. Don't re-add it without a
  real hung page to point at.
- **The AX tree is the whole document, not the viewport, and `click` already calls
  `DOM.scrollIntoViewIfNeeded`.** So "below the fold" was never unreachable — phase 7's gap
  table said it was and the code disagreed. What scroll actually buys is content not in the
  DOM yet (infinite feeds, lazy lists) and scrolling an open flyout instead of the page
  behind it. Don't re-derive this from the symptom.
- **A truncation or error message must only name a recovery the agent can perform.** The old
  cap notice said "scroll or narrow the page" — it could do neither. It now names the literal
  next call, `snapshot with from: N`.
- **A tab Chrome has just created reports `url: ""`** and carries the real one in
  `pendingUrl` until the navigation commits — reading `.url` there rejects every new tab as
  undrivable. `useTab` checks the url string it was handed instead.
- **A tab's first navigation away from the initial empty document REPLACES that entry**
  rather than pushing one, so a history built through `about:blank` can have nothing to go
  back to. `pickTab()` opens tabs at `about:blank`, so this bites here specifically — the
  self-test's back/forward check moves between two served pages instead. Likely cause of the
  first live failure, not isolated: the CDP rewrite below landed in the same change.
- **`chrome.tabs.goBack` reports "Cannot find a next page in history." for going BACK too** —
  Chromium reuses one string for both directions — and the API takes no argument, so the
  failure names nothing. `go()` reads `Page.getNavigationHistory` and drives
  `navigateToHistoryEntry`, and its error prints the whole entry list.
- **A wheel event unconsumed inside an OOPIF bubbles out to the parent document.** Measured:
  the no-ref `scroll` aims at the viewport centre, which on the fixture is inside the
  cross-origin frame, and it still scrolled the host page. No frame-aware aiming needed.
- **A self-test that can throw must not report by returning.** A stack trace replaced the
  entire PASS/FAIL list once, hiding 27 passing checks — unreadable as working or broken,
  which is worse than a FAIL. `runChecks` throws, `selftest` catches and always reports.
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
  hits the 300-line cap — type into it to filter, or `snapshot from: 300`. Note `from` applies
  **per frame**, since the cap always did.
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
