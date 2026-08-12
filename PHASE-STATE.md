# Endoplexity — phase state

**Goal: replicate Perplexity Comet's browser-control feature**, driven by existing Claude (Pro or
Max) and Cursor subscriptions instead of metered API keys. Design doc: `docs/specs/design.md`.
Job-applying is a *test scenario*, never the product — judge features by "does Comet do this on
any site", not "does this finish the job-form task".

**Shape:** Chrome side panel (MV3) → local Node bridge → `claude -p` / `cursor-agent -p`.
The bridge exposes 14 browser tools over MCP; the CLIs are the agent loop. The extension never
talks to a model, the CLI never talks to Chrome.

**Run:** `npm install` · `npm run setup` (once — autostarts the bridge at login, no token) ·
`npm test` · `npm run cursor-login` (once, for the Cursor models — never `cursor-agent login`).
Then `chrome://extensions` → Load unpacked → `extension/`, open the side panel, type a task, hit
Run; **Reply** (ctrl+Enter) continues the last conversation. The bridge is invisible, so its
output is `.endo-bridge.log`; `Endoplexity.vbs` is the manual start. Panel console:
`endo.selftest("C:\path\to\file.pdf")`, `endo.measure()`, `endo.log()`. File keys live in
`.endo-files.json` (copy `.endo-files.example.json`). See `docs/handrun.md`.

**Reading order:** a fresh session needs only "Next session — start here" below (~70 lines).
Everything after `## Done` is reference — history, settled decisions, and the gotcha ledger —
read on demand, not on arrival. The file stays long on purpose: the gotchas each cost a real
failed run to learn, and trimming them to hit a line count would trade money for tidiness.

---

## Next session — start here

**Everything left in phase 11 is blocked on ONE live run, and it is the same run for both
features.** They were queued as separate work and they are not: a single task executed once on
claude and once on cursor, with turns / tokens / cost read off the panel's own chip, produces
the number feature 2 wants *and* the comparison feature 3 needs. Nothing else can be built from
a terminal. Do the run first, then decide what code follows.

**The claude baseline moved on 2026-08-10 (`f8cc273`) and no run has used it yet.** P11a fixed a
P7 defect where claude's briefing preloaded **7 of 13** tools, so scroll/hover/back/forward/
tabs/use_tab each cost a second ToolSearch round trip — a whole turn, and every turn re-sends
the ones before it. **Every claude number recorded before that commit is a measurement of the
defect.** "Kinda ass with claude" may already be partly fixed. Measure before diagnosing, and do
not start feature 3 by rewriting prompts.

**Read before trusting any number:** Enter is a fresh Run, ctrl+Enter is a Reply. Four
measurement runs have already died — wrong tab, Reply, laptop sleep, and an agent answering
from memory without browsing. Confirm `endo: attached to tab N — <url>` in the panel console
before believing an action failed. Any `↩` in a log voids that run as a measurement.

### The live checklist — one pass discharges five phases' worth of owed verification

None of this is doable from a terminal; all of it is cheap once the extension is loaded.

1. **Load `extension/` unpacked** and confirm Chrome's id is `lblllkbcfcaecfpefighocaefnfkebjj`.
   A unit test recomputing our own formula cannot catch a disagreement with Chrome. *(P9)*
2. **`await endo.selftest()` → 27/27.** *(P7/P9)*
3. **The measurement run itself**, same task on claude and on cursor — record turns, tokens,
   cost, wall clock for each. *(features 2 and 3)*
4. **One answer containing a table**, to confirm the P9b markdown path renders live. *(P9b)*
5. **`read_file` inside a real task** — ask a question whose answer is only in the resume, and
   read something past 8,000 chars so the `from:` paging path runs for the first time. *(P11a)*
6. **Close and reopen the side panel mid-task**; events must keep arriving and land in the
   right session. *(P9/P9c)*
7. **Theme follows the browser both ways**, composer stays one line at your real width. *(P9b)*
8. **C8, the Cursor checklist** on `composer-2.5` and `cursor-grok-4.5-medium` — the only thing
   that retires "never really tried it with cursor". *(P5/P9)*
9. **A cookie-walled page does not stop the run.** *(P9)*
10. **The P11b restyle in a real side panel** — the new icon in Chrome's toolbar, and the empty
    state actually on screen on a fresh session (it was verified headless, where the composer
    and the seed rows are real but Chrome's own panel chrome around them is not). *(P11b)*
11. **`@`-mention a tab in a real run** — the menu is verified headless, but nothing has yet
    watched a model receive an `id N` it did not ask for and call `use_tab` with it. That is the
    whole claim of the feature. *(P11c)*
12. **Run from a window with no drivable tab** (one fresh New Tab page) and confirm you are not
    taken anywhere until the agent actually navigates. *(P11c)*

### Phase 11 — the two features left

1. ~~File input the agent can READ~~ — **done, P11a.**
2. **Token efficiency, second pass.** The user's words are "this is too consuming". P3 measured
   the 5-tool world; the bill now carries a 14-tool schema (~1,829 tokens at 13, `read_file`
   adds ~180) plus `full:` returns. Known levers if the number justifies them: dead OOPIF
   sessions still costing a failed round trip and a noise line each, stale-ref recovery costing
   a whole page, and `full:` on a redirect wall being paid before you learn the page was wrong.
3. **The claude path brought up to the cursor path's quality.** "Kinda ass with claude, really
   good with cursor" is the standing verdict and has never been diagnosed — C8 was written to
   test cursor. Find out *what* is worse (turns? tool adoption? fake-XML retries? the deferred-
   MCP-tools hypothesis?) before touching anything, **and re-measure post-`f8cc273` first.**

### Parked launch chores (P10) — each needs a browser, a camera, or a decision only you can make

- **Create the GitHub repo and push.** Assumed URL `github.com/Endokelp/endoplexity`, written
  into `README.md` and the LinkedIn draft — if the real one differs, both change. First push is
  the moment to confirm no `.endo-token` / `.endo-files.json` / `.endo-mcp.json` rode along.
- **Record the demo.** Shot list in `docs/launch.md`. The gate frame at 16–21s is the one that
  answers "you let an AI click submit?".
- **Post it.** Draft written, needs a real link.
- **Decide the copyright name.** `NOTICE` says "Endokelp" — the git identity, not necessarily
  the name wanted on a legal notice.

### Still queued, unscheduled

Cheaper stale-ref recovery than a whole page; Chrome tab groups (rejected for now — Claude's
version drew four bug reports for groups that multiply and never clean up); styled mention
chips, if plain `@label` text in the box turns out to read as ordinary prose.

---

## Done

- **P0–P2 — handshake, CDP tool layer, MCP relay.** Loopback WS gated on extension origin AND
  timing-safe token; flat auto-attach, one CDP session per OOPIF, generation-based stale refs;
  `/mcp` over that same socket.
- **P3 — token efficiency.** Snapshots default to actionable + headings; actions return the page
  they produced. **Baseline: one google run at $0.0984 / 111,872 tokens / 9 turns.** Prose-
  cutting alone was **1.5x, not 2x** — the surviving actionable lines are the long ones.
- **P4 — approval gate.** `gate.ts` is the policy, `relay()` the single chokepoint. 60s silence,
  no panel, or a panel dropping mid-gate all deny. Approve and deny both verified live.
- **P5 — Cursor adapter + model picker**, end to end on `composer-2.5` and
  `cursor-grok-4.5-medium`; shell denied, `apiKeySource: "login"`.
- **Session continuity + page context.** The bridge `--resume`s the CLI session id; the panel
  gains **Reply**, live only when the last run left a transcript. The panel names the current
  page in every task prompt — without it "apply to *this* job" was unanswerable. Necessary but
  NOT sufficient: see the different-tab gotcha.
- **P6 — v1, agent-driven form fill (2026-08-06).** `upload` takes a configured KEY and scans
  every frame's DOM for `input[type=file]` because real ATS forms hide it; `select` drives a
  native `<select>`; `key: Enter` is gated on irreversible-labelled controls; stale refs return
  the fresh page so recovery costs no turn. On the real Cloudflare Greenhouse form `upload`
  found **both** hidden inputs and **the gate intercepted a real "Submit application" click**;
  after the page-context fix **the agent drove that form unaided**. **Rescoped** from "3 real
  job sites": job-applying is the test case, not the product.
- **P7 — reachability, 7 tools → 13 (2026-08-06).** `scroll` (a real `mouseWheel`), `hover`,
  `back`/`forward` (`Page.getNavigationHistory` + `navigateToHistoryEntry`), `tabs`/`use_tab`,
  and `snapshot from:`. Verified live 27/27. Corrected its own premise: the AX tree is the whole
  document, so below the fold was never unreachable. **Left a defect P11a found and fixed** —
  the claude briefing kept preloading only the original 7.
- **P8 — multi-tab research (2026-08-09, deliverable NOT met).** Shipped `full` on
  `navigate`/`use_tab` (~87 tokens/turn), a fresh Run re-attaching to the active tab, and
  Enter/ctrl+Enter swapped. **P7's inherited cost gate IS discharged** — a real Cloudflare
  Greenhouse application, agent-driven: **$0.0959 / 112,064 tokens / 10 turns / 42s** against
  P3's **$0.0984 / 111,872 / 9 turns**. Flat, while paying ~18k of tool schema the baseline
  never did, so 5 → 13 tools cost nothing. **The research number was never obtained** — four
  attempts died four different ways. Proved on the way: `full:` is adopted unprompted, stale-ref
  recovery works and costs a whole page each time, and redirect walls make `full:` expensive.
- **P9 — refinement (2026-08-09).** Scoped from the four things that made it unshowable.
  **No terminal, no token:** `npm run setup` writes a Startup-folder `.vbs`; the extension id is
  pinned by an RSA `key` in the manifest and the WS upgrade is gated on that exact origin. An
  HTTP `/pair` was built first and **deleted** — Chrome sends no Origin on an extension
  `fetch()`, so it refused its own panel. **A conversation, not a log:** `md.js` + `transcript.js`
  — markdown, one collapsed `<details>` per tool call, cost as a chip; tool rows come from
  `answer()`, which **deleted** both CLIs' tool-parsing branches. **Robustness:** `sendPanel()`
  resolves the socket at call time, `hello` restores state on reconnect, backoff + 20s heartbeat,
  15s orphan grace kill. **Three autonomy modes** (`watch`/`normal`/`trust`) enforced in the
  bridge, never in a prompt. 54 → 78 tests.
- **P9b — the panel redesigned from zero (2026-08-10).** Opened by the verdict "grok-4.5 works,
  the panel is holding it back" — flooded with tool usage, formatting not showing. `PRODUCT.md` +
  `DESIGN.md` hold the design context. **Instrument, not editorial:** one sans family, OKLCH
  neutrals at hue 150, three colour roles only (green live/primary, ochre needs-you, red
  danger). **The trace recedes** through size, weight and position — not lighter grey, which
  would have failed AA. **Formatting the model actually meant:** h1–h6, `__bold__`, `~~strike~~`,
  nested lists, task checkboxes, and **equations** via `math.js` → native MathML (KaTeX rejected:
  ~280KB vendored under a CSP forbidding external hosts). One inline SVG sprite. Themed
  `appearance: base-select` dropdowns. 78 → 96 tests.
- **P9c — sessions that survive (2026-08-10).** `transcript.js` journals every rendered entry as
  plain data and can `restore()` it; `sessions.js` (DOM-free) holds the list, newest first, 20 ×
  400 entries × 2,000 chars/field; `panel.js` mirrors to `chrome.storage.local` on a 400ms
  debounce. `+` archives the live session, a History sheet reads any back. Falls out for free:
  Chrome tears the panel down on every window switch, so **the transcript no longer vanishes
  when you look at another window** — that was the everyday bug, not the headline. 96 → 106
  tests. **The storage cap is a guess:** nobody has weighed a real 10-turn `full:` run against
  the 10MB quota.
- **P10 — rebrand to Endoplexity, launch-ready (2026-08-10).** `CometClone` named a competitor's
  product with "Clone" attached. Renamed case-sensitively so genuine "Perplexity Comet"
  references survive: brand, `globalThis.endo`, the `endo:` CDP log prefix, and **MCP server
  `comet` → `endo`** (model-facing, but pinned by claude.test.ts and cursor.test.ts). Runtime
  dotfiles were **renamed on disk rather than regenerated**, so the token, the file map and
  `~/.endo-cursor`'s Cursor login all survived. `LICENSE` is **Apache-2.0**, fetched verbatim —
  chosen over MIT for its §6 no-trademark clause and fuller liability disclaimer, which is what
  matters for software that can click "Submit". `NOTICE` carries the non-affiliation statement,
  which does more protective work than the licence choice. New `README.md` and `docs/launch.md`.
- **P11a — the agent can READ a file, 13 tools → 14 (2026-08-10, `f8cc273`).** First of phase
  11's three, picked as the only one not blocked on a live run. `read_file` takes a configured
  KEY through the same `files.ts` `resolve()` `upload` uses, so the model still never sees a
  path, and it **skips `relay()` and the gate** — it never touches Chrome, and reading a file the
  human allow-listed is not irreversible. `docs.ts` is DOM-free and dependency-free except for
  the one place a dependency was right: **pdf**. docx/xlsx/pptx are zips of XML, so a ~35-line
  central-directory walk plus `node:zlib` covers them; `unpdf` (**zero transitive deps**,
  imported lazily so a run that reads nothing pays no startup) does PDF. Anything else is
  **sniffed, not extension-matched** — every source file, `.csv`, `.ini` reads as text without a
  language list; images and the old `.doc`/`.xls` binaries refuse with a message naming the fix.
  Excel dates resolve through `styles.xml` rather than staying serial numbers, and empty cells
  keep their column — both are facts the agent would otherwise state wrongly. Returns cap at
  8,000 chars and page with `from:`. **Verified over `/mcp`:** 14 tools list; a real call on the
  configured resume returned 4,891 chars, `isError=false`, `from: 10` → 4,881; a bogus key
  returns a readable `isError`. **106 → 130 tests.**
  - **Accepted, deliberate widening:** the agent can now read a configured file's *contents* and
    could type them into a page. `upload` never exposed content. The allow-list is still the
    whole boundary and this is the point of the feature — but it is a real change in what a
    confused run can leak, not a regression to be "fixed" later.
  - **The 8,000-char cap is arithmetic, not measurement** (~2k tokens), and the resume that
    motivated the feature came in at 4,891 — so the paging path has never run on a real document.
- **P11b — dead frames reaped, the profile pane deleted, a Comet-shaped panel and a real logo
  (2026-08-10).** Picked as the three things left that a terminal can finish; features 2 and 3
  stay blocked on the live run above.
  - **Dead OOPIF sessions.** Chrome does not reliably send `Target.detachedFromTarget` when an
    OOPIF's renderer goes away, so `sessions` accumulated corpses and every later snapshot paid
    a failed round trip and a noise line each, forever. **The failure IS the notification**:
    `dropIfDead()` reaps on `session with given id|target closed` and on nothing broader, in
    both loops that walk frames (`snapshot`, `upload`). A reaped frame no longer narrates
    itself — it does not exist, so there is nothing the model could act on. First-ever unit test
    for cdp.js: a `chrome` stub installed **once** before a dynamic import, because the module
    registers its debugger listeners at import time and a second stub is never wired up.
  - **The Profile pane is gone**, textarea, storage key and all (old installs get a
    `storage.local.remove`). P11a's `read_file` reads the real resume through the allow-list, so
    a second hand-typed copy was personal data kept for nothing — and it was the last
    job-application costume in the UI.
  - **The panel took Comet's shape, not Perplexity's identity.** Floating 20px composer holding
    every control, the question as the heading of the answer, pill selects, Run as a filled
    circle with an arrow, radii one notch softer throughout, and the header rule deleted so the
    shell stops reading as two stacked toolbars. **Palette unchanged** — Perplexity-teal is on
    PRODUCT.md's anti-reference list and `NOTICE` carries a non-affiliation statement, so the
    green stays. One `--accent` line flips it if that call was wrong.
  - **A real mark and real icons.** A browser window whose right column is solid with the
    pointer it drives the page with inside. `icon.svg` is the same 16-unit artwork as `#i-mark`
    under a `transform` so the two cannot drift; `extension/icons/*.png` are rendered from it at
    exactly 16/32/48/128 and wired into the manifest. `*.png binary` added to `.gitattributes`.
  - **Found while verifying: the empty state had never been visible.** `add()` hid it for every
    entry, and panel.js's own greeting note was the first entry on a fresh panel — the
    invitation and its three example tasks rendered and vanished in the same frame. Notes are
    now exempt (they are the panel talking about itself, not conversation) and the redundant
    greeting note is deleted. **130 → 132 tests.**

- **P11c — `@`-mention a tab, and Run stops yanking you to a blank page (2026-08-12).**
  - **The blank-tab yank.** `pickTab()` opened an `active: true` `about:blank` and the panel
    re-attaches on every fresh Run — so from a window holding only a New Tab page (chrome:// is
    not drivable), pressing Run dropped you on a black page under a "started debugging this
    browser" banner and left you there for the model's whole first turn. **Opening a tab is now
    only for a caller that is about to USE one**: `attach(target, { open: false })` returns null
    instead, the panel passes it, and the first tool call opens the tab — which `navigate` then
    fills in the same breath. The `where` chip reads "no tab attached yet" until it does.
  - **`@`-mention.** Type `@` in the composer, get the drivable tabs in the window (same
    `DRIVABLE` filter as the `tabs` tool, now shared through `cdp.drivable()`), filter by typing,
    arrows/Enter or click to pick. **A mention carries no page content** — it carries the tab's
    **id**, in the exact line shape `tabs` already returns, so `use_tab` is the obvious next call
    and the agent skips the `tabs` turn it would otherwise spend discovering ids. Inlining the
    other tab's text was rejected twice over: snapshotting an unattached tab means detaching and
    killing every live ref, and the page would then be re-sent on every later turn read or not.
  - **The composer stays a plain `<textarea>`.** A mention is the literal text `@Title`, and
    `mentions.js` reconciles by asking whether that text is still in the box — backspacing a
    mention un-mentions it, with no caret bookkeeping and no chip widget. Sent on replies too,
    unlike the page line: a tab named in a follow-up is new information.
  - Verified headless in a true 360px iframe, both themes: menu opens on `@`, filters to one row
    on `@netl`, Enter inserts the label and closes it, horizontal overflow 0. **132 → 140 tests.**

---

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
- **`read_file` is not gated and does not relay.** It never touches Chrome, so there is no page
  to return and nothing for the gate to weigh; `files.ts`'s allow-list is the whole boundary,
  the same one `upload` goes through
- **Document returns are capped and paged, like snapshots.** A tool return crosses the model's
  context on every LATER turn too, so one 40k-character spreadsheet is paid ten times over a
  ten-turn task
- **A mention hands over an id, not a page.** `@`-ing a tab tells the model the tab exists and
  what its id is, in the shape `use_tab` takes; the model decides whether that page is worth a
  turn. Inlining the content instead would detach from the attached tab to snapshot it — killing
  every ref the agent holds — and then re-send a whole page on every later turn, read or not
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

- **Never rotate `.endo-token` or `.endo-files.json` without asking.**
- **Opening a tab is a side effect, and the panel does it on every Run.** `pickTab()` created an
  active `about:blank` whenever nothing drivable was open, and the pre-Run re-attach called it
  before the model had asked to go anywhere — so Run from a fresh window meant staring at a black
  page under a debugger banner for a whole turn. Same rule as `currentPage()`, which was already
  written this way: **building a prompt must not have side effects.** Only a caller about to
  drive a tab may open one.
- **An `@` menu must not fire inside an email address.** Form-filling tasks type addresses far
  more often than mentions, so the trigger is anchored to a word boundary (`(?:^|\s)@`) and the
  query takes no spaces — an unanchored one turned `name@example.com` into a tab picker, and a
  space-tolerant query kept the menu open across a whole sentence, matching less and less.
- **A click on a menu row blurs the textarea first.** The blur handler closes the menu, so the
  click lands on nothing and the caret position the label was going to is already gone. The rows
  `preventDefault()` on `mousedown`, which is what makes a plain `blur` → close safe.
- **claude's `PRELOAD` list and mcp.ts's `registerTool` calls are two hand-written lists that
  must agree.** P7 took the tool count 7 → 13 and left the briefing at 7, so six tools each cost
  an extra ToolSearch round trip — a whole turn — for two phases and every measurement in them.
  `claude.test.ts` now pins one against the other by reading mcp.ts's source. **Adding a tool
  means adding it to `PRELOAD`.**
- **Dropping the bridge's session id has to survive a disconnected socket.** New Session sends
  `new-session`, but with the panel disconnected there is nothing to send it to — and the
  bridge still holds the id, so its next `hello` said `resumable: true` and lit Reply back up
  on the session that was just archived. `dropBridgeSession()` latches and re-sends on the next
  hello, and that hello's own `resumable` is ignored because it describes the pre-drop state.
- **The empty state is hidden, never removed.** Its seed buttons are wired once at load, so a
  removed node takes its listeners with it and New Session brings back dead buttons. Caught in
  headless: `send()`'s "not connected" note re-hid it the instant after `clear()` un-hid it.
- **`el.className = x` silently does nothing on an SVG element.** There it is a read-only
  `SVGAnimatedString`, so the assignment is dropped without an error — `setAttribute("class")`
  is the only way. Bit the `#where-state` icon the moment it stopped being a text glyph.
- **Two `base-select` traps, both of which fail SILENTLY into the native look.** A descendant
  combinator after a pseudo-element is invalid, so `::picker(select) option { … }` drops the
  entire rule — style `option`/`optgroup`/`legend` with plain selectors (nothing leaks into the
  closed trigger, which renders a `<selectedcontent>` clone of the option's child nodes, not
  the option). And `optgroup label="…"` is UA-drawn: group captions need a real `<legend>`
  child. Both were written the wrong way first, and the only symptom was a picker that still
  looked native while `getComputedStyle().appearance` said `base-select`.
- **A `<select>` cannot be opened by a synthetic click** — `showPicker()` needs transient user
  activation. Screenshotting an open dropdown means driving Chrome over CDP and dispatching a
  real `Input.dispatchMouseEvent`.
- **Verifying the panel in headless Chrome needs an iframe.** Chrome refuses a window narrower
  than ~500px, so `--window-size=360` lays out at 526 and merely *crops* the image — which
  looks exactly like a horizontal-overflow bug and is not one. Load the panel in a 360px
  iframe to get a true viewport, and measure with `documentElement.clientWidth` rather than
  trusting the flag. Headless also reports `prefers-color-scheme: dark`, so the light theme
  has to be forced (`Emulation.setEmulatedMedia`) to be seen at all. Serve the iframe from the
  same origin as its host and the top frame can just reach in via `contentWindow` — no
  per-frame execution context needed. The `chrome` stub must include `debugger.onEvent` and
  `debugger.onDetach`: cdp.js registers those at **import** time, so the module throws on load
  without them.
- **Enter is a fresh Run; ctrl/cmd+Enter is a Reply.** It used to be the other way round —
  Reply won the key whenever it was live, and Reply stays live forever after any finished
  task, so "type the next task, hit Enter" silently resumed the previous conversation. Cost
  two measurements on 2026-08-09; one had a laptop comparison running with a whole Greenhouse
  application in context. Changed because the asymmetry is one-sided: a fresh Run is at worst
  more expensive, a wrong Reply is wrong. **Any `↩` number in a log is void as a measurement.**
- **A captured socket is why "reconnect" was never enough.** `startTask`'s `send` closed over
  the `ws` that delivered the `task` message. `relay.ts` re-points its own `panel` on
  reconnect, so every *tool call* kept working through a panel remount — but task events went
  to the dead socket forever, so the run carried on invisibly and the panel looked idle until
  it ended. Fixed by `sendPanel()`, which resolves the socket at call time. **Any future
  panel-side reconnect work is decoration without it**; `relay.test.ts` pins it.
- **The gate no longer fires on cookie banners** — `accept`/`agree` came out of
  `IRREVERSIBLE` (P9). Accepted residual: a page whose *only* irreversible control reads "I
  accept" (EULA-style) now goes ungated. Do not re-add the words to fix that; add the context
  the label is missing.
- **Anything appended to the transcript hides the empty state, so notes must be exempt.**
  `add()` hid `#empty` unconditionally, and a fresh panel's very first act was posting a
  greeting note — so the invitation and its three seed tasks were rendered and hidden in the
  same frame, and nobody ever saw the empty state on the surface it exists for. Fixed in P11b
  by exempting `.note`. **Any new "the panel is talking about itself" row belongs in that
  exemption**, or it silently takes the first screen with it.
- **cdp.js can only be unit tested with the `chrome` stub installed ONCE, before a dynamic
  import.** It registers `debugger.onEvent` / `onDetach` at import time, so a top-level import
  throws and a per-test stub is never wired up — the second test's `attachedToTarget` would go
  to a listener the first stub captured. `cdp.test.ts` keeps one stub with a mutable `fail`
  function instead.
- **A dropped socket kills the run mid-gate.** Laptop sleep disconnected the panel; the
  approval landed after "not connected" and went nowhere. Nothing resumes.
- **"Nothing was filled" can mean the agent filled a DIFFERENT TAB.** `attach()` binds once
  and nothing re-bound it, so a panel left open kept driving whatever tab was active when it
  first attached. Measured 2026-08-09: attached to `about:blank`, user opened a Greenhouse
  posting in another tab, agent navigated *its own* tab there and filled the form perfectly —
  every tool returned success, every value landed, none of it on the page being watched.
  Fixed by re-attaching on a fresh Run, but the diagnostic habit matters more: **read
  `endo: attached to tab N — <url>` in the panel console before believing an action failed.**
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
  next call, `snapshot with from: N`; `read_file`'s paging notice follows the same rule.
- **A tab Chrome has just created reports `url: ""`** and carries the real one in
  `pendingUrl` until the navigation commits — reading `.url` there rejects every new tab as
  undrivable. `useTab` checks the url string it was handed instead.
- **A tab's first navigation away from the initial empty document REPLACES that entry**
  rather than pushing one, so a history built through `about:blank` can have nothing to go
  back to. `pickTab()` opens tabs at `about:blank`, so this bites here specifically — the
  self-test's back/forward check moves between two served pages instead.
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
  resumed run's init, so "no endo tools in init" is NOT proof of a broken run, which weakens
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
- **A committed binary fixture needs `.gitattributes`.** `hello.pdf` stores byte offsets in its
  xref table, and git's default LF → CRLF on Windows shifts every one of them and the file stops
  parsing. `*.pdf binary` — caught at `git add`, when the diff said "33 lines" instead of "Bin".
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
- Running a second bridge to smoke-test rewrites **both** `.endo-mcp.json` and
  `~/.endo-cursor/home/.cursor/mcp.json` to that port. Back both up, or restart the real one.
  **Importing `mcp.ts` alone does not** — only `index.ts` writes those files, which is what
  makes a tools/list smoke test safe to run against a live bridge.
- Greenhouse runs an **invisible reCAPTCHA enterprise** iframe — expect it on real submits.
- Cursor's model ids are not the design doc's: `cursor-grok-4.5-{low,medium,high}`, each with a
  `-fast` twin; `--list-models` needs login and is the source of truth. Its stream-json is
  claude-shaped but not identical — tool calls are their own `type: "tool_call"` event and
  `usage` is **camelCase**, so reading one spelling prints a 60k-token run as 0.
- Piping a native command through `Select-Object -First N` in PowerShell closes the pipe and
  kills the child. It killed a `cursor-agent login` mid-OAuth and read as a failed login.

## Security invariants (do not regress)

- Bind `127.0.0.1` only. **The WS upgrade is gated on the origin alone — the token is gone from
  that path**, reversing the old "both origin AND token" invariant. The origin is an **exact
  match** against the id derived from the RSA `key` in `extension/manifest.json` (`auth.ts`
  derives it from the manifest at load, never hardcoded, so the two cannot drift into "nothing
  connects"). The token only ever backed up a *weak* check — `startsWith("chrome-extension://")`,
  which every extension satisfied. Against one pinned id it adds nothing, because the panel is a
  browser page: its only way to *receive* a token is over a channel gated by that same origin.
  **The token is still the whole boundary on `/mcp`**, where it is load-bearing because a CLI
  sends no Origin
- **Do not re-add an HTTP pairing endpoint.** Measured 2026-08-09: Chrome sends **no `Origin`
  header at all** on `fetch()` from an extension page when the extension holds host permissions
  — the request is privileged rather than CORS — so `/pair` refused its own panel. The
  **WebSocket upgrade does** carry a real Origin, and page script cannot set one. That asymmetry
  is why the identity check lives on the socket
- **The autonomy mode is transported with the task and enforced in the bridge**, never in a
  prompt, and the model never sees it. An absent or unrecognised mode is `normal`, never
  `trust` — it fails closed. `trust` disables the gate entirely, so the panel keeps it on
  screen in red the whole time it is set
- **`upload` and `read_file` resolve a key, never a model-supplied path** — `files.ts` rejects
  relative paths and unknown keys; the model never sees a filesystem path at all. `read_file`
  additionally exposes file *contents* to the model, which `upload` did not — a deliberate,
  recorded widening (P11a), bounded by the same human-edited allow-list
- **`--resume` restores a conversation, not a permission set.** Every restriction flag is
  passed again on a resumed spawn. Verified 2026-08-04 by reading a resumed run's init event —
  `ToolSearch` + `mcp__endo__*` and nothing else — not by reading docs
- The Cursor CLI has **no tool flags at all** — its boundary is `permissions.deny` (`Shell(*)`,
  `Write(*)`, `Read(*)`, `WebFetch(*)`) plus `allow: ["Mcp(endo:*)"]`, and it only holds while
  HOME is pinned. Verified by running a shell call, not by reading docs
- claude spawns with **`--tools "ToolSearch"`** (an allowlist — a denylist was measured failing)
  plus `--allowedTools "ToolSearch,mcp__endo__*" --strict-mcp-config --setting-sources ""`.
  `--tools ""` is wrong too: MCP tools arrive **deferred**, ToolSearch is the only way to reach
  them, and it must be in `--allowedTools`. `--setting-sources ""` is worth real money — with
  the operator's hooks and CLAUDE.md loaded, a one-tool task billed 33k tokens of preamble and
  $0.41 instead of $0.02
- `/mcp` requires the token and **refuses any request carrying an `Origin`**. Re-verified
  2026-08-04: 401/401/401/200
- The token never goes in argv — it lives in `.endo-mcp.json`, mode 0600, gitignored
- No `--dangerously-skip-permissions`, and never `--bare` (it forces `ANTHROPIC_API_KEY`)
