# Endoplexity — phase state

**Goal: replicate Perplexity Comet's browser-control feature**, driven by existing Claude Max
and Cursor subscriptions instead of metered API keys. Design doc: `docs/specs/design.md`.
Job-applying is a *test scenario*, never the product — judge features by "does Comet do this
on any site", not "does this finish the job-form task".

**Shape:** Chrome side panel (MV3) → local Node bridge → `claude -p` / `cursor-agent -p`.
The bridge exposes browser tools over MCP; the CLIs are the agent loop. The extension never
talks to a model, the CLI never talks to Chrome.

**Run:** `npm install` · `npm run setup` (once — autostarts the bridge at login, no token) ·
`npm test` · `npm run cursor-login` (once, for the Cursor models — never `cursor-agent login`).
Then `chrome://extensions` → Load unpacked → `extension/`, open the side panel, type a task,
hit Run; **Reply** (ctrl+Enter) continues the last conversation. The bridge is invisible, so
its output is `.endo-bridge.log`; `Endoplexity.vbs` is the manual start. Panel console:
`endo.selftest("C:\path\to\file.pdf")`, `endo.measure()`, `endo.log()`. Uploads read
`.endo-files.json` (copy `.endo-files.example.json`). See `docs/handrun.md`.

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

- **P8 — multi-tab research (closed 2026-08-09, deliverable NOT met).** Shipped `full` on
  `navigate`/`use_tab` (~87 tokens/turn; all 13 tools ~1,829), a fresh Run re-attaching to the
  active tab, and Enter/ctrl+Enter swapped. **P7's inherited gate IS discharged** — a real
  Cloudflare Greenhouse application, agent-driven: **$0.0959 / 112,064 tokens / 10 turns /
  42s** against P3's **$0.0984 / 111,872 / 9 turns**. Flat, while paying ~18k of tool schema
  the baseline never did, so 5 → 13 tools cost nothing. **The research number was never
  obtained** — four attempts died four different ways: wrong tab, Reply, laptop sleep, and
  finally the agent answering from memory without browsing at all. Proved live on the way:
  `full:` is adopted unprompted, stale-ref recovery works (and costs a whole page each time),
  and redirect walls make `full:` expensive — you only learn a page was wrong after paying
  to read it.

- **P9 — refinement (code landed 2026-08-09, live verification OWED).** Scoped from the four
  things that made it unshowable: startup, unreadable output, robustness, an unexercised
  Cursor path. Design target researched **first-party rather than from memory** — Perplexity's
  three stated principles (**transparency, user control, sound judgment**), Claude for Chrome's
  three-mode `PermissionManager`, Gemini's chronological action list. Shipped:
  - **No terminal, no token.** `npm run setup` writes a Startup-folder `.vbs`. The extension
    id is pinned by an RSA `key` in the manifest (`lblllkbcfcaecfpefighocaefnfkebjj`,
    confirmed against Chrome) and the WS upgrade is gated on that exact origin — no token on
    the panel path at all. An HTTP `/pair` was built first and **deleted**: Chrome sends no
    Origin on an extension `fetch()`, so it refused its own panel. Verified by curl: upgrade
    401 for no origin / another extension / a website, **101** for ours; `/mcp` still
    401/401/401/200 with 13 tools.
  - **A conversation, not a log.** `md.js` (pure testable `parse`, `createElement`-only
    `toDom`) + `transcript.js`: markdown with tables, one collapsed `<details>` per tool call,
    a live step line, cost as a chip. Tool rows now come from `answer()` — the bridge already
    sends name+args — which **deleted** both claude's `tool_use` parsing and cursor's
    `tool_call` branch.
  - **Robustness.** `sendPanel()` resolves the socket at call time (gotcha below), `hello`
    restores running/resumable on reconnect, backoff + 20s heartbeat, 15s orphan grace kill.
  - **Three autonomy modes** (`watch`/`normal`/`trust`) chosen in the panel, enforced in the
    bridge, never in a prompt; `watch` remembers an approval for the rest of the task or it is
    unusable. **Deliberately reopened the locked auto-run decision, at user request.**
  - `accept`/`agree` out of `IRREVERSIBLE`; an unknown model now fails instead of silently
    running Sonnet; `EADDRINUSE` prints a sentence. **78/78 tests**, was 54.

- **P9b — the panel redesigned from zero (code landed 2026-08-10, live verification OWED).**
  The verdict that opened it: grok-4.5 works, and the panel was the thing holding it back —
  "flooded with tool usage", and formatting "not showing". Both were real and both are fixed.
  Design context now lives in `PRODUCT.md` + `DESIGN.md` at the root (written this session, via
  the impeccable skill). Register **product**, colour strategy **restrained**, theme **follows
  the browser and is never white**. Shipped:
  - **Instrument, not editorial.** The warm-cream-plus-serif answer was the second-order
    category reflex and read as costume. One sans family, OKLCH neutrals tinted to hue 150,
    hairline rules, tabular numerals. Three colour roles and no others: green = live/primary/
    success, ochre = needs-you, red = danger. Claude-amber, Perplexity-teal and Linear-violet
    were all rejected as the category's reflex palettes.
  - **The trace recedes.** 11.5px, `--text-soft`, one sentence, folded, behind a single
    unbroken rail (a `.trace` wrapper, not a per-row border). Only the dot and the word
    "failed" carry colour. It recedes through size, weight and position — **not** through
    lighter grey, which would have bought the same look by failing AA.
  - **Formatting the model actually meant.** h1–h6 (was h1–h3, and a `####` used to eat the
    following line), `__bold__`, `~~strike~~`, nested lists by indent, task checkboxes, and
    **equations**: `math.js` is a LaTeX subset → **native MathML**, no library. KaTeX was
    rejected — ~280KB vendored under a CSP that forbids any external host, for a minority of
    answers. Verified rendering a real quadratic and `\left(…\right)^2`.
  - **Proper icons.** One inline SVG sprite, 16px grid, 1.5px stroke, `currentColor`, `<use>`.
    The text glyphs `○ ● ✓ ✕` are gone.
  - **The dropdowns are ours now.** `appearance: base-select` (Chrome 135+, we are on 151) —
    the OS-drawn white sheet with the blue highlight is replaced by a themed picker that fades
    and lifts on open, with hover rows, a rotating chevron and a green tick. Still a real
    `<select>`, so keyboard and a11y are free and `panel.js` still just reads `.value`.
    Secondary controls became ghosts; only Run stays filled.
  - **78 → 96 tests** (`math.test.ts` is new; `parseMath` is DOM-free for exactly that reason).

- **P9c — sessions that survive (code landed 2026-08-10, live verification OWED).** First of the
  four queued features, picked as the cheapest: panel-side plus one line in the bridge, no
  measurement run and no new dependency. `transcript.js` now journals every rendered entry as
  plain data and can `restore()` it, `sessions.js` (DOM-free, so testable) holds the list —
  newest first, `sessions[0]` live, 20 sessions × 400 entries × 2,000 chars per field — and
  `panel.js` mirrors it into `chrome.storage.local` on a 400ms debounce. **A `+` in the header
  archives the live session; a History sheet in the footer reads any of them back.** Falls out
  for free: Chrome tears the side panel down on every window switch, so **the transcript no
  longer vanishes when you look at another window** — that was the everyday bug, not the
  headline feature. Reply is off while reading history, New is off while a task runs, and Run
  snaps back to live first. **96 → 106 tests**; the DOM half was checked in headless Chrome
  (17 assertions, both themes, footer one row at 360px *and* 320px).

- **P10 — rebrand to Endoplexity, and made launch-ready (2026-08-10).** `CometClone` names a
  competitor's product with "Clone" attached, which is a bad public repo and trademark-adjacent;
  the user chose **Endoplexity**. Renamed case-sensitively so genuine "Perplexity Comet"
  references survive: brand, `globalThis.endo` console API, the `endo:` CDP log prefix, and the
  **MCP server `comet` → `endo`** (so `mcp__endo__*`, `Mcp(endo:*)`) — model-facing, but pinned
  by claude.test.ts and cursor.test.ts, so drift cannot go silent, and one char shorter per tool
  name than before. Runtime dotfiles went `.comet-*` → `.endo-*` and were **renamed on disk
  rather than regenerated**, so the token, the file map and `~/.endo-cursor`'s Cursor login all
  survived; no migration shim ships in the repo for a rename with one user. `LICENSE` is
  **Apache-2.0**, fetched verbatim (11,358 bytes) rather than written from memory — chosen over
  MIT for its §6 no-trademark-licence clause and its fuller liability disclaimer, which is the
  part that matters for software that can click "Submit". `NOTICE` carries the non-affiliation
  statement, which does more protective work than the licence choice does. New: `README.md`
  (architecture, safety model, the measured cost, honest known-gaps), `docs/launch.md` (the
  LinkedIn post, a demo shot list, a repo-settings checklist). **106/106 tests still pass**, and
  the old `CometClone.vbs` was deleted from the Startup folder so login does not fire two bridges.

## Current phase: 10 — launch

**Done from a terminal (above).** What is left is everything that needs a browser, a camera, or
a decision only the user can make:

- **Create the GitHub repo and push.** Assumed URL `github.com/Endokelp/endoplexity` — it is
  written into `README.md` and the LinkedIn draft, so if the real one differs, both change.
  `docs/launch.md` has the repo-settings checklist; the first push is the moment to confirm no
  `.endo-token` / `.endo-files.json` / `.endo-mcp.json` rode along.
- **Record the demo.** Shot list is in `docs/launch.md`; the recording itself cannot be produced
  from here. The gate frame at 16–21s is the one that answers "you let an AI click submit?".
- **Post it.** Draft is written and needs a real link before it goes out.
- **Decide the copyright name.** `NOTICE` says "Endokelp" — the git identity, not necessarily
  the name wanted on a legal notice.

**Still owed from phase 9 — all live, none of it doable from a terminal:** load `extension/`
unpacked and confirm Chrome's id equals `lblllkbcfcaecfpefighocaefnfkebjj` (a unit test
recomputing our own formula cannot catch a disagreement with Chrome); `await endo.selftest()`
back to 27/27; one real task whose answer contains a table; close and reopen the side panel
mid-task and confirm events keep arriving; a cookie-walled page not stopping; and **C8, the
Cursor checklist** on both `composer-2.5` and `cursor-grok-4.5-medium` — the only thing that
retires "never really tried it with cursor".

**Owed for P9b specifically:** the redesign was verified in headless Chrome against a
synthesised transcript, at 360px and 320px, in both themes — real layout, real MathML, no
horizontal overflow. That is not the same as a real run: **reload the unpacked extension** and
confirm the theme follows the browser both ways, the composer stays on one line at the width
you actually use, and a real agent answer containing a table renders. `scripts/` has no preview
harness; it was scratch, and rebuilding it is a 90-line http server plus a swapped `<script>`.

**Owed from P8, still owed:** the research cost number, and whether C0's one-line briefing
clause ("never answer from memory") actually fixes the zero-tool research answer. If it does
not, the deferred-MCP-tools hypothesis survives and earns real budget.

**Queued behind the launch, set by the user (2026-08-10)** — after a run where "grok 4.5 works
like butter" and the product is finally usable, these four are what stand between it and an
experience. **Sessions + history is done (P9c above).** The three left: **file input the agent
understands** (pdf, docx, xlsx — not just `upload`'s opaque file-to-a-form-field path; the
agent must be able to *read* an attachment); **token efficiency** — the user's words are "this
is too consuming", so P3's measurement work gets a second pass with the 13-tool schema and
`full:` returns now in the bill; and **the claude path brought up to the cursor path's
quality** — "kinda ass with claude, really good with cursor" is the standing verdict, and C8
was going to test cursor, not claude.

**Owed for P9c:** the storage cap is a guess, not a measurement — pack() clips a field at
2,000 chars and keeps 400 entries, but nobody has watched what a real 10-turn run with `full:`
snapshots actually weighs against the 10MB quota. Also unverified live: that a task running
while the panel is closed and reopened lands its events in the right session.

**Still queued:** dead OOPIF sessions; cheaper stale-ref recovery than a whole page; the
profile field's job-shaped costume; `@`-mentioning a tab as context (Comet has it, our
fresh-Run re-attach covers the failure that actually bit us); Chrome tab groups (rejected for
now — Claude's version drew four bug reports for groups that multiply and never clean up);
and a compression pass on this file, now well over the 150-line cap. **README/LICENSE landed
in P10;** the demo recording is the only launch asset still outstanding.

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

- **Never rotate `.endo-token` or `.endo-files.json` without asking.**
- **Dropping the bridge's session id has to survive a disconnected socket.** New Session sends
  `new-session`, but with the panel disconnected there is nothing to send it to — and the
  bridge still holds the id, so its next `hello` said `resumable: true` and lit Reply back up
  on the session that was just archived. That is the cross-conversation bug the Enter/Reply
  swap already cost two measurements to. `dropBridgeSession()` latches and re-sends on the next
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
- **Dead OOPIF sessions are never removed from `sessions`.** After enough navigations,
  snapshots trail `(frame f25 unavailable: Session with given id not found.)` — seen 3 at
  once — costing a failed CDP round trip and a line of noise per dead frame, forever.
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
- Greenhouse runs an **invisible reCAPTCHA enterprise** iframe — expect it on real submits.
- Cursor's model ids are not the design doc's: `cursor-grok-4.5-{low,medium,high}`, each with a
  `-fast` twin; `--list-models` needs login and is the source of truth. Its stream-json is
  claude-shaped but not identical — tool calls are their own `type: "tool_call"` event and
  `usage` is **camelCase**, so reading one spelling prints a 60k-token run as 0.
- Piping a native command through `Select-Object -First N` in PowerShell closes the pipe and
  kills the child. It killed a `cursor-agent login` mid-OAuth and read as a failed login.

## Security invariants (do not regress)

- Bind `127.0.0.1` only. **The WS upgrade is gated on the origin alone now — the token is
  gone from that path, reversing the old "both origin AND token" invariant.** The origin is an
  **exact match** against the id derived from the RSA `key` in `extension/manifest.json`
  (`auth.ts` derives it from the manifest at load, never hardcoded, so the two cannot drift
  into "nothing connects"). The token only ever backed up a *weak* check —
  `startsWith("chrome-extension://")`, which every extension satisfied. Against one pinned id
  it adds nothing, because the panel is a browser page: its only way to *receive* a token is
  over a channel gated by that same origin, so anyone who can forge the origin collects the
  token first. A token the client fetches for itself is theatre. **The token is still the
  whole boundary on `/mcp`**, where it is load-bearing because a CLI sends no Origin
- **Do not re-add an HTTP pairing endpoint.** Measured 2026-08-09: Chrome sends **no `Origin`
  header at all** on `fetch()` from an extension page when the extension holds host
  permissions — the request is privileged rather than CORS — so `/pair` refused its own panel
  (`refused /pair from origin=(none)`). The **WebSocket upgrade does** carry a real Origin, and
  page script cannot set one. That asymmetry is why the identity check lives on the socket
- **The autonomy mode is transported with the task and enforced in the bridge**, never in a
  prompt, and the model never sees it. An absent or unrecognised mode is `normal`, never
  `trust` — it fails closed. `trust` disables the gate entirely, so the panel keeps it on
  screen in red the whole time it is set
- **`upload` resolves a key, never a model-supplied path** — `files.ts` rejects relative paths
  and unknown keys; the model never sees a filesystem path at all
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
