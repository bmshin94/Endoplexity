# CometClone — phase state

**Goal: replicate Perplexity Comet's browser-control feature**, driven by existing Claude Max
and Cursor subscriptions instead of metered API keys. Design doc: `docs/specs/design.md`.
Job-applying is a *test scenario*, never the product — judge features by "does Comet do this
on any site", not "does this finish the job-form task".

**Shape:** Chrome side panel (MV3) → local Node bridge → `claude -p` / `cursor-agent -p`.
The bridge exposes browser tools over MCP; the CLIs are the agent loop. The extension
never talks to a model, the CLI never talks to Chrome.

## Run it

`npm install` · `npm start` (prints the token) · `npm test` · `npm run cursor-login` (once,
for the Cursor models — never `cursor-agent login`). Then `chrome://extensions` → Load
unpacked → `extension/`, open the side panel, paste the token once, type a task, hit Run.
Panel console: `comet.selftest("C:\path\to\file.pdf")`, `comet.measure()`. Uploads read
`.comet-files.json` (copy `.comet-files.example.json`). See `docs/handrun.md`.

---

## Done

- **P0 — authenticated handshake.** Loopback HTTP+WS, token bootstrap, upgrade gated on
  extension origin AND timing-safe token. curl 401/401/401/101.
- **P1 — CDP tool layer.** Flat auto-attach, one session per OOPIF, generation-based stale
  refs. 7/7 incl. a trusted click in a real cross-site OOPIF.
- **P2 — MCP server + Claude adapter.** `/mcp` relayed over the existing WS; `claude -p`
  with `--mcp-config`. A google search+open ran unattended.
- **P3 — token efficiency + panel UI.** Snapshots default to actionable + headings;
  `navigate`/`click`/`key` return the page they produced. One google run at **$0.0984 /
  111,872 tokens / 9 turns** with a single snapshot. Prose-cutting alone was **1.5x, not
  2x**: lines halved, tokens did not — the surviving actionable lines are the long ones.
- **P4 — approval gate.** `gate.ts` is the policy and the only place that decides;
  `mcp.ts`'s `relay()` is the single chokepoint so it cannot be half-wired. 60s silence,
  no panel, or a panel dropping mid-gate all deny. Approve and deny both verified live.
- **P5 — Cursor adapter + model picker.** `cursor-agent` native Windows, no WSL, in a
  bridge-owned profile; model → adapter off an allowlist map. Ran end to end on
  `composer-2.5` and `cursor-grok-4.5-medium`. Shell denied, `apiKeySource: "login"`.

## Current phase: 6 — v1, form-fill hardening — **PARTIALLY COMPLETE, NOT SHIPPED**

Built and unit-verified (`npm test` **43/43**, `comet.selftest()` **13/13** incl. upload
and select against the OOPIF fixture):

- **`upload(file, match?)`** — takes a configured KEY, never a path. Scans every frame's
  DOM for `input[type=file]` rather than taking a ref, because real ATS forms hide the
  input and it is absent from the AX tree entirely.
- **`select(ref, value)`** — native `<select>` via `Runtime.callFunctionOn` + bubbling
  `input`/`change`.
- **`key: Enter` gated** when the page carries any irreversible-labelled control.
- **Stale/unknown refs return the fresh page** with the error, so recovery costs no turn.
- **Panel profile field** — see "over-fitted" below.

**Verified live on the real Cloudflare Greenhouse form (2026-08-04), by driving `/mcp`
directly with curl — no model in the loop:**
- `upload` found **both** hidden file inputs (`resume`, `cover_letter`) that the AX tree
  shows only as "Attach" buttons; `match:"cover"` correctly hit the second. Greenhouse
  confirmed by swapping "Attach" → "Remove file".
- **The gate intercepted a real "Submit application" click** and denied on the 60s
  timeout — the click never reached Chrome.

**NOT verified — this is why the phase is not closed:**
- **The agent never completed the task.** Both live runs failed: one stopped to ask for
  applicant data, one emitted fake `<function_calls>` XML (14 fake calls, 1 turn, $0.06).
  Every tool result above came from driving MCP by hand. **Done-when says "'Apply with my
  resume' completes on 3 real job sites" — that has not happened once.**
- **Only 1 site, not 3** (user scoped to Cloudflare 2026-08-04). Lever and Ashby untested.
- **Multi-page untested** — the Cloudflare form is single-page.
- **`select` is near-useless on real ATS forms** (see gotchas) — click+click is the real path.

## Carried forward — still open

- **No session continuity.** Every task is a fresh spawn — no `--resume`, no stored session
  id — so an agent that asks a question has nowhere to receive an answer and the run dies.
  P6 predicted this would be optional; the first live run proved otherwise. For a Comet
  clone this is a missing feature, not a nicety. **Highest-value next build.**
- **Stale refs are still the top cost sink.** P6 made the error carry the fresh page, but
  that has never been exercised live.
- **Panel profile field is over-fitted to job applications.** Generic prompt-context in a
  job-shaped costume. Generalise (a persistent "what Comet knows about me" store, per the
  user's Obsidian-folder idea) or drop it.
- **Panel frontend is unreadable.** The agent's markdown renders raw (`**bold**`) into a
  `<pre>`, and there is no way to reply to a question the agent asks.

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
| 6 | **v1 — form-fill hardening** | *(open)* "Apply with my resume" completes **agent-driven**, incl. upload + multi-page + gated submit |
| — | **Refinement** | User-requested, grounded in research on what Comet actually does: session continuity, memory, panel UX, cost |
| 7 | Multi-tab research | "Compare these 5 laptops" → table in panel |

---

## Decisions locked

- **Side panel + local bridge**, not a Chromium fork; **`chrome.debugger` from the
  extension**, not external CDP, so it uses the already-logged-in profile; **the panel owns
  the WebSocket and CDP**, not the service worker, which dodges MV3 idle teardown
- **Auto-run, gate irreversible actions** — the gate lives in the bridge, never in a prompt,
  and **reads labels off the page text it already relays** rather than asking the panel what
  a ref points at. Cost: it depends on ax.js's line format, hence the gate test using the
  real `serialize()`
- **Mouse to the element's own session, keyboard to the main session.** Measured: the same
  submit does nothing at translated root coords on the main session and submits at frame
  coords on the frame's own. Events sent to the main session are hit-tested by the root
  renderer and never cross into an OOPIF, so no coordinate translation exists anywhere
- **Actions return the page they produced.** A separate `snapshot` is a whole model turn, and
  a turn re-sends everything. `type` is the deliberate exception
- **`upload` takes a configured key and no ref.** `DOM.setFileInputFiles` runs in the browser
  process and can read anything, so a model-chosen path is exfiltration; and the real input is
  hidden and absent from the AX tree (measured on Greenhouse — only "Attach" buttons show)
- **The Cursor CLI runs in a bridge-owned profile, pinned by two env vars, not one.**
  `CURSOR_CONFIG_DIR` covers `cli-config.json` and the session; `mcp.json` resolves off
  `homedir()`, so HOME/USERPROFILE are pinned too. Cursor has no `--tools`, so the boundary
  is `permissions.deny` in a config file the bridge owns
- **Spawn `node.exe index.js`, never the `cursor-agent` shim** — node cannot spawn a `.cmd`
  without `shell: true`, which would re-parse the user's prompt on a command line
- **No build step yet** — plain HTML/JS extension. Add Vite + React only if a phase needs it

## Gotchas

- **Never rotate `.comet-token` or `.comet-files.json` without asking.**
- **Real ATS dropdowns are not `<select>`.** Greenhouse/Lever/Ashby use an `<input>` plus a
  flyout listbox, so `select` refuses them. `click` the combobox → its options appear in the
  AX tree with refs → `click` the option. Measured on Greenhouse: the country flyout returns
  **307 lines** and hits the 300-line cap, so type into it to filter before clicking.
- **A successful upload hands back a page that looks like it failed.** React re-renders the
  attach UI after `settle()`'s 300ms, so Greenhouse still read "No file chosen" right after
  the file landed. The return line says "succeeded" first for exactly this reason.
- **The fake-`<function_calls>` retry only looked at the `result` event** and so never fired
  on a run whose final message was clean. Now latched across all events. Costs ~$0.06 a miss.
- Auto-attach also hands you **workers and service workers** — register `type === "iframe"`.
  Pin the ref generation for a whole snapshot, or early frames read stale and later ones
  don't. Only one debugger per tab: the tab under test must not have devtools open.
- **Never assume the active tab is drivable.** `chrome://*` and the web store reject both
  `chrome.debugger` and `tabs.update` — always go through `attach()`'s picker.
- **A click that opens a new tab returns the old page.** `settle()` watches the attached tab.
- **Token cost is a design constraint, not a chore.** Every tool return crosses the model's
  context on every later turn. Measure a task's cost before and after any tool change.
- **Actions return the page, so anything that breaks rendering reads as a broken action.**
  Rendering must never throw on page data: no AX field is a guaranteed string.
- Running a second bridge to smoke-test rewrites `.comet-mcp.json` to that port. Restart the
  real one afterwards.
- Greenhouse runs an **invisible reCAPTCHA enterprise** iframe — expect it on real submits.
- Cursor's model ids are not the design doc's: `cursor-grok-4.5-{low,medium,high}`, each with
  a `-fast` twin; `--list-models` is the source of truth and needs login. Its stream-json is
  claude-shaped but not identical — tool calls are their own `type: "tool_call"` event and
  `usage` is **camelCase**, so reading one spelling prints a 60k-token run as 0.
- Piping a native command through `Select-Object -First N` in PowerShell closes the pipe and
  kills the child. It killed a `cursor-agent login` mid-OAuth and read as a failed login.

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- **`upload` resolves a key, never a model-supplied path** — `files.ts` rejects relative
  paths and unknown keys; the model never sees a filesystem path at all
- The Cursor CLI has **no tool flags at all** — its boundary is `permissions.deny`
  (`Shell(*)`, `Write(*)`, `Read(*)`, `WebFetch(*)`) plus `allow: ["Mcp(comet:*)"]`, and it
  only holds while HOME is pinned. Verified by running a shell call, not by reading docs
- claude spawns with **`--tools "ToolSearch"`** (an allowlist — a denylist was measured
  failing) plus `--allowedTools "ToolSearch,mcp__comet__*" --strict-mcp-config
  --setting-sources ""`. `--tools ""` is wrong too: MCP tools arrive **deferred**, ToolSearch
  is the only way to reach them, and it must be in `--allowedTools`. `--setting-sources ""`
  is worth real money — with the operator's hooks and CLAUDE.md loaded, a one-tool task
  billed 33k tokens of preamble and $0.41 instead of $0.02
- `/mcp` requires the token and **refuses any request carrying an `Origin`**. Re-verified
  2026-08-04: 401/401/401/200
- The token never goes in argv — it lives in `.comet-mcp.json`, mode 0600, gitignored
- No `--dangerously-skip-permissions`, and never `--bare` (it forces `ANTHROPIC_API_KEY`)
