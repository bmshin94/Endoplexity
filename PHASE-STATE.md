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
**Measuring:** `npm run bench -- <model> <label> "<task>"` runs a real task through the real
adapter against the live browser and prints turns / tokens / cost / tool sequence. Needs a
connected panel — and a **reloaded** one, see the gotchas.

**Reading order:** a fresh session needs only "Next session — start here" below (~70 lines).
Everything after `## Done` is reference — history, settled decisions, and the gotcha ledger —
read on demand, not on arrival. The file stays long on purpose: the gotchas each cost a real
failed run to learn, and trimming them to hit a line count would trade money for tidiness.

---

## Next session — start here

**Phase 12 is closed and the repo is audit-clean. What is left is a camera and a `git push`.**
`click` was never broken — the failing session ran a cached pre-P11e build whose refs were walk
positions, so the click landed on a different node (full account under Phase 12). A reloaded
HEAD build passes the link-navigation checks live. Four audits — legal, backend, frontend,
click — are done and their fixes are committed (P12a); no BLOCKER survived. **The remaining work
is the launch chores below: record the demo, create the repo, push.** Both are yours; neither is
a code change.

**One thing still owed before the demo:** the token numbers in the README belong to a stale
panel. P11e's 3.8x has still never run in a browser — item 3 on the checklist, and it is now
cheap, because the panel is already reloaded and correct.

**The run that blocked this phase is no longer blocked, and it is no longer manual.** "Nothing
else can be built from a terminal" was wrong: the bridge's own `/mcp` endpoint answers from a
terminal, and the CLI adapters are plain functions, so `npm run bench -- <model> <label> "<task>"`
spawns the production adapter against the live browser and prints turns / tokens / cost / the
whole tool sequence. It needs a connected side panel and nothing else. Four measurements died
before it existed; none of the ways they died is reachable through it.

**Feature 3 was measured on 2026-08-12 and the premise inverted — read this before touching a
prompt.** Same task, byte-identical prompt, same browser, back to back:

| | cursor-grok-4.5-medium | claude sonnet |
|---|---|---|
| wall | 64.6s | 91.6s |
| turns that called tools | 9 | 8 |
| …of them **pure tool discovery** | **4** | **1** |
| output tokens | 1,617 | 3,208 |
| cost | not reported (subscription) | $0.2052 |
| answer vs HN's API | correct | correct, fuller |

**claude's deferred-tool defect is gone and cursor has one.** claude makes exactly one
`ToolSearch` carrying the whole `select:` list and gets all 14 tools — P11a (`f8cc273`) confirmed
live, first time. cursor reaches its tools with `getMcpTools` in **`mode: "single_tool"`** — one
schema per call, each in a turn of its own, immediately before first use of navigate, click,
tabs and snapshot. Four of its nine turns bought nothing. **"Kinda ass with claude" did not
reproduce**: both answers were right, claude's was more complete. It is slower and twice as
chatty, not worse. Do not rewrite the claude briefing to fix a defect that is no longer there.

**Every live number taken before now measured a stale extension.** Chrome caches an unpacked
extension's files until you reload it at `chrome://extensions`, and a panel remount re-runs the
*cached* code — so editing files and reopening the panel changes nothing. The panel that served
this measurement was the **pre-P11e build**: no `sinceLast`, so the delta never fired once, and
three byte-identical 6,706-char pages were sent inside one run. **P11e's 3.8x has still never run
in a browser.** The one-glance tell is in the refs — `@f0e1, @f0e2, @f0e3…` contiguous from 1 is
the old walk counter; HEAD mints backend node ids, which are large and gappy.

**Read before trusting any number:** Enter is a fresh Run, ctrl+Enter is a Reply. Four
measurement runs have already died — wrong tab, Reply, laptop sleep, and an agent answering
from memory without browsing. Confirm `endo: attached to tab N — <url>` in the panel console
before believing an action failed. Any `↩` in a log voids that run as a measurement.

### The live checklist — one pass discharges five phases' worth of owed verification

Cheap once the extension is loaded. Items 3 and 5 now run from a terminal via `npm run bench`.

0. **RELOAD the extension at `chrome://extensions` first, every time.** Nothing else on this
   list means anything against a cached build, and nothing on screen says which build it is.
   Check the refs in any snapshot: contiguous from `@f0e1` is stale. *(2026-08-12)*
1. ~~**Load `extension/` unpacked** and confirm Chrome's id~~ — **discharged 2026-08-14, and by
   something stronger than reading it off the page.** The panel reached the bridge, and the WS
   upgrade is gated on an exact match against the id derived from the manifest's RSA `key`. A
   connected panel *is* the proof the id agrees with Chrome's. *(P9)*
2. ~~**`await endo.selftest()`**~~ — **run 2026-08-14 on a reloaded build: 28 PASS, 2 SKIP, 1
   FAIL, and the failure was in the check, not the code.** Both new checks pass, which is what
   closed phase 12. The skips are by design (no `filePath` given; no decoy button to scope a
   scroll to). The failure — "re-reading an untouched page costs one line, not a page" — measured
   an unchanged re-read as a **fraction of the page**, but that response is a fixed 97-char
   marker, so on the 379-char fixture a delta doing its job exactly landed at 25.6% against a 25%
   bar. Now asserted absolutely, against `UNCHANGED` imported from ax.js. **Re-run to see it
   green** — the product code was never wrong, so nothing else waits on it. *(P7/P9/P12)*
3. ~~The measurement run itself~~ — **done 2026-08-12, both legs.** Re-take it post-reload,
   because the numbers above were served by a pre-P11e panel. *(features 2 and 3)*
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
13. **A multi-tab run puts its tabs in one green group named after the task**, and a second run
    does not stack a second group on top of the first. *(P11d)*
14. **A real agent acting on a patch.** `await endo.selftest()` now covers the mechanism, but no
    model has yet been handed `--- the page you last read, unchanged except:` and gone on to
    click the right thing from a page it read four turns ago. This is the one risk deltas carry,
    and only a live run retires it. *(P11e)*

### Phase 11 — closed, and it opened phase 12

1. ~~File input the agent can READ~~ — **done, P11a.**
2. ~~Token efficiency, second pass~~ — **done, P11e. 3.8x off page returns, measured.**
3. ~~The claude path brought up to the cursor path's quality~~ — **diagnosed, P11f. The gap runs
   the other way.** Nothing was done to the claude briefing, deliberately: the defect it would
   have been fixing was already fixed in P11a. cursor got the correction instead.

### Phase 12 — CLOSED 2026-08-14 without a line of `cdp.js` changing. The bug was the build.

**`PASS clicking a link navigates the tab`**, live, on a reloaded HEAD build. The whole phase was
chasing a defect that does not exist in the tree: the failing session ran the pre-P11e build,
where a ref was a **walk position**, so `@f0e17` had come to mean a different node by the time it
was clicked. Clicking the wrong node hands back the same page and reports success — which is
exactly what was seen, and why it read as a mouse-event bug. Two hypotheses were measured dead
first (below); both were about the arithmetic, and the arithmetic was never wrong.

**What this cost, and the lesson worth keeping:** the ruling-out step ran
`git diff … -- extension/cdp.js`, saw byte-identical `centreOf` and `click`, and wrote off "the
stale build". Refs are minted in **ax.js**, which changed 58 lines in the same range. The refs
quoted in the bug report — `@f0e3`, `@f0e12`, `@f0e17`, small and contiguous — were themselves
the evidence of a stale build, sitting in plain sight in the report the whole time.

Retained below because a dead hypothesis that reads this plausible will be re-derived otherwise.

---

Found while measuring feature 3. Both models saw
`@f0e17 [link] "200 comments"` correctly serialised, both clicked it, both were handed the front
page back; claude then routed around it by navigating to HN's Firebase JSON, cursor by trying
two more refs. Reproduced with no model in the loop at all — a story title (an ordinary external
`<a href>`), a nav link, and a comments link, top of page and bottom, **none of them navigate**:

```
click "200 comments"  @f0e17  -> 29 comment-links, still FRONT page
click story title     @f0e12  -> 29 comment-links, still FRONT page
click nav "new"       @f0e3   -> still FRONT page
```

**Both original hypotheses are now DEAD, measured 2026-08-14 by replicating `centreOf` and
`click` byte-for-byte over raw CDP against a Chrome launched with `--remote-debugging-port`, no
extension and no model in the loop:**

- **Coordinate space is NOT the bug.** `DOM.getBoxModel`'s `content` quad is *already*
  viewport-relative CSS pixels on Chrome 151 and agrees with what `Input.dispatchMouseEvent`
  expects. A link at the top and an identical link 2,318px below the fold both navigated, and
  `elementFromPoint` matched the intended `<a>` before dispatch at scroll offset 2318. **All
  three of the exact HN links above navigated correctly** (`document.location` as the
  discriminator, not link-presence). Do not re-derive this theory from the symptom — it reads
  extremely plausible and it is wrong.
- **Window occlusion is NOT the bug.** Button and link both pass identically with the window
  `normal` and `minimized`.
- `settle()` timing is not it either: on HN, `frameStartedLoading` at 97ms and `loadEventFired`
  at 328ms, inside the 300ms sleep + 10s cap.

**The explanation that survived, and is now confirmed live:** the ref pointed at a different
node. `ax.js:106-114` describes the failure in its own words — *"a counter renumbers everything
below any element that appears or disappears, so after a re-render @f0e12 silently meant a
DIFFERENT control"* — which is what a pre-P11e ref was. HEAD mints `backendDOMNodeId`, large and
gappy; the live run confirms it (`hover @f0e195`). Checks 28 and 29 both **PASS**.

**Why 27/27 never caught it:** every click check in the self-test drives a *button* that
rewrites the page in place, and `back`/`forward` go through `Page.navigateToHistoryEntry` rather
than the mouse. `click` was only ever proved on the half of the web that does not navigate. The
fixture now carries a link and the self-test clicks it (checks 28 and 29).

### P12a — the pre-open-source audit (2026-08-14). Four parallel audits: legal, backend, frontend, and the click bug

Everything below is terminal-verifiable and done; **155 → 156 tests**. Nothing here needed a
browser, which is why it went first.

- **Legal: clean.** No secret ever entered git history (swept all 38 commits, not just HEAD);
  `LICENSE` is verbatim Apache-2.0; the full 93-package dependency tree is MIT/ISC/BSD with zero
  copyleft; competitor references are defensible nominative use. Fixed: a real local path in
  `docs/specs/design.md:11`, `Endoplexity.vbs` missing from `.gitignore`, and `COMET_PORT` —
  the last old-brand identifier in source — renamed `ENDO_PORT`.
- **Three real crash paths, all the same root cause: valid JSON that is not an object.** A bare
  `null` line from either CLI reached `sessionOf()` and killed the bridge; a `null` WS frame did
  the same through `msg.type`; and `?? []` does not fire on a truthy non-array, so a string
  `content` reached `.some`. Guarded at both parse boundaries rather than at each reader.
  `process.on('uncaughtException')` is now a **backstop, not an error channel** — the bridge runs
  windowless from a Startup `.vbs`, so dying is silent and indistinguishable from a broken install.
- **`files.ts` used `key in config`**, which walks the prototype chain — `"constructor"` and
  `"toString"` passed the one check the entire file boundary rests on. `Object.hasOwn` now, the
  idiom `index.ts:153` already used.
- **`setup.mjs` checked nothing before writing the launcher.** Node version and `claude`/
  `cursor-agent` on PATH are checked first, because a written launcher makes a broken install
  look like a finished one and the failure surfaces at next login, into a log nobody knows about.
- **The panel could lose history silently.** `cut()` clipped strings only, so a tool row's `args`
  **object** went to storage uncapped — one `type` call carrying a pasted cover letter, which is
  the product's own demo scenario. Neither `storage.local.set` had a `.catch`, so hitting the 10MB
  quota was invisible. `sessions.js:17-19` had predicted this failure in a comment and it could
  still happen. Pinned by a test **verified to fail on the previous commit**.
- **Accessibility, against PRODUCT.md's own AA commitment:** `--text-faint` measured 4.40:1 on
  `--bg` and 4.07:1 on `--sink` in light theme — under AA, on the cost chip and the connection
  state, which are content. Now 0.53. `<select>` options had `outline: none` plus a **1.13:1**
  background shift, so keyboard users arrowed through an unmarked list. The `@`-mention menu had
  no `aria-expanded`/`activedescendant`, so for a screen reader it did not exist — the rows never
  take focus by design. Tool rows are `aria-live="off"`: the trace recedes for AT the way it
  already receded visually, instead of firing one announcement per call.
- **`<all_urls>` → `http/https/file`**, matching what `DRIVABLE` has always accepted. Same
  behaviour, and it drops Chrome's broadest install-time warning — which matters the week a repo
  goes public.
- **No XSS vector.** The render path never touches `innerHTML`; `md.js`/`math.js`/`transcript.js`
  build DOM through `createElement`/`textContent` only, `SAFE_HREF` allowlists `http(s)` so
  `javascript:` degrades to literal text, and images are never rendered at all. Attempted
  bypasses through link titles, malformed hrefs, nested MathML and unclosed fences all failed.
- **`SECURITY.md` added** — private reporting via GitHub rather than a published email address,
  and an explicit "known and accepted" list so the gate heuristic, `read_file`'s content exposure
  and Windows' `0600` are documented limits rather than future surprise reports.
- **README corrected where it oversold:** the gate is a keyword match on a button's visible
  **label**, so an icon-only or non-English submit goes ungated; `read_file` puts file contents in
  the model's context where `upload` never did; and "106 unit tests" was two phases stale.

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
- **P11d — three things a grok demo exposed (2026-08-12).** All three were "small" and all three
  are why the panel did not read as finished.
  - **The answer printed twice.** Both CLIs emit the final message as an assistant event *and* as
    the result's summary, and the panel dropped the repeat by comparing it to the **last** thing
    said. That is right only when the answer is the last thing said — grok closed with a sources
    line after it, so the result matched nothing and the whole table rendered a second time under
    the first. Now the run keeps everything said and drops a result already contained in it.
  - **Run stopped leaving the task in the box.** It was kept on purpose ("a re-read task is worth
    re-running"), but the task is already the heading of its own answer, so the box just held a
    stale copy under a live run that the next task had to be typed around.
  - **Tabs the agent opens now land in one named group**, titled by the task. Previously rejected
    for a real reason — the known failure is groups that multiply and are never cleaned up — so
    the rules are: one group id per run, checked to still exist before reuse, and **only tabs the
    agent itself opened**, never one the human already had. No cleanup path, because Chrome drops
    an empty group by itself. Needs the new `tabGroups` permission.
  - Verified by replaying that exact run through the panel headless: on the previous commit it
    renders **2 copies** of the answer and keeps the prompt; after, **1** and an empty box.
    **140 → 143 tests.**

- **P11e — a page is sent once, then only what moved (2026-08-12). Feature 2, closed with a
  number.** Half of it was never blocked on a live run: what a *page* costs is deterministic and
  measurable from a terminal against real sites, and that is where the bill is.
  - **Measured first, on real pages through the real `serialize()`:** a snapshot taken after an
    action is **99.6% identical** to the one before it — 260 lines, one of them new. Actions
    return the page they produced and every return is re-sent on every later turn, so a ten-turn
    task paid for that page **fifty-five times**. The 14-tool schema people worry about is ~1,829
    tokens; this is tens of thousands.
  - **Refs are keyed on the backend DOM node id, not a walk counter.** This is the enabling
    change, not a tidy-up: a counter renumbered everything below any element that appeared or
    disappeared, so a held ref silently came to mean a *different control* — which is why every
    snapshot had to invalidate the one before it. **Verified on real pages: 260/260 and 713/713
    refs survive a relabel plus a banner inserted at the very top of the document, and zero point
    at a different node.** Under the old scheme that insertion moved every ref on the page.
  - **So a snapshot no longer bumps the generation.** Only navigation, a detached frame or a new
    attachment do — the events that really do end a ref's meaning. Re-reading a page the agent is
    working on no longer throws away everything it knows about that page, which also retires the
    "stale-ref recovery costs a whole page" lever from the other direction.
  - **`delta()` in ax.js** returns the changed lines under a marker, or **null when more than 40%
    of the page moved** — past that a delta is no shorter than the page (every changed line costs
    a `-` and a `+`) and a model reassembling one is a merge error away from the wrong click.
    Five deltas maximum before a full page, because the CLIs compact long conversations and a
    model whose full page was compacted away cannot patch onto anything.
  - **The gate patches its label map instead of replacing it.** A delta names only what changed,
    and "Submit application" is precisely what does *not* change while a form is filled — so a
    wholesale replace would have blinded the approval gate to every irreversible control on the
    page. `UNCHANGED` is imported from ax.js rather than copied, because a drifted copy is a gate
    that never fires. Pinned by a test that fails the ungated-submit way.
  - **Result: 3.8x off page returns** — 119,856 → 31,626 tokens on a ten-turn HN task, 143,275 →
    37,536 on Wikipedia (73.6% / 73.8%). For scale, P3's prose-cutting was 1.5x. **151 → 155
    tests**, and the self-test gained two live checks plus a shorter form flow: it used to re-find
    every ref after every action, purely because refs went stale.

- **P11f — feature 3, measured instead of guessed (2026-08-12).** The phase's last item, and the
  work was to find out *what* was worse before touching anything. The answer is that the claude
  path is no longer the worse one.
  - **The blocker was not real.** "Nothing about this is answerable from a terminal" had been
    true of the panel, not of the system: `/mcp` takes a `tools/call` over plain HTTP, and
    `runClaude`/`runCursor` are exported functions. `scripts/bench.ts` spawns the production
    adapter — same flags, same briefing, same isolated cursor profile — against the live browser
    and reads turns, tokens, cost and the tool sequence off the stream. **Both legs of a task
    that five phases had been waiting on ran in about three minutes.**
  - **Scored, not believed.** The task was HN's top 3 stories plus the first top-level comment
    on #1, with ground truth pulled from HN's own API — so "answered from memory", the worst
    failure this thing has, would have shown as wrong numbers rather than as a confident table.
    Both models were right.
  - **claude: one ToolSearch, 14 tools.** P11a's `PRELOAD` fix verified live for the first time.
    **cursor: four `getMcpTools` calls in `mode: "single_tool"`**, one schema each, one turn
    each, 4 of 9 turns. The comment in cursor.ts asserting that "cursor hands MCP tools to the
    model directly" was wrong in both halves and was why cursor had no preload line. It has one
    now — **unmeasured**, because the panel dropped before the after-number could be taken.
  - **Where claude's money actually goes:** of $0.2052, cache *writes* are $0.1135 (55%), cache
    reads $0.0429 (21%), output $0.0481 (23%). Not page size — the conversation itself.
  - **The rig was measuring code that is not in the tree** (see the gotcha below), so every page
    number here belongs to the pre-P11e build and must be re-taken after a reload. The
    claude-vs-cursor comparison survives it: both legs ran against the same stale panel.

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
- **A ref names the node, not its position in the walk, and a snapshot no longer invalidates the
  one before it.** Positional refs forced every read to throw away every ref, because inserting
  one element renumbered everything under it. Keyed on the backend DOM node id a ref means the
  same element until the element goes away — which is what makes it safe to return only the
  lines that changed, and what makes a re-read cheap instead of destructive
- **A page is sent whole once, then as a patch — but never more than five patches running, and
  never when more than 40% of it moved.** Both bounds are about the model, not the byte count: it
  has to be able to reassemble the page from something still in its context, and past ~40% the
  patch stops being smaller than the page anyway
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
- **Chrome runs the extension it CACHED, not the files on disk, until you reload it — and a
  panel remount does not reload it.** The side panel is torn down on every window switch, so it
  feels like the code is re-read constantly; it is re-run from cache. On 2026-08-12 a whole
  claude-vs-cursor measurement was served by a pre-P11e panel: deltas never fired, and three
  byte-identical 6,706-char pages went out inside one run, which reads exactly like a delta bug
  in code that was never running. **Reload before any live number, and check the refs**:
  contiguous from `@f0e1` is the old walk counter, large and gappy is `backendDOMNodeId`. Nothing
  in the panel names its build.
- **`DOM.getBoxModel` returns VIEWPORT coordinates, not document coordinates.** Measured on
  Chrome 151, 2026-08-14: its `content` quad feeds `Input.dispatchMouseEvent` directly and
  correctly, at any scroll offset. The opposite reads as obvious — "box model" sounds
  document-absolute, and `click` calls `scrollIntoViewIfNeeded` first, which *looks* like it must
  desynchronise the two — and a whole phase was pointed at it. If a click misses, suspect **which
  node the ref resolved to**, not the arithmetic that turned that node into a point.
- **Excluding "the stale build" for one file does not exclude it for the feature.** Phase 12's
  ruling-out ran `git diff … -- extension/cdp.js` and concluded the loaded build was equivalent.
  Refs are minted in **ax.js**, which changed 58 lines in the same range. When a symptom crosses
  two files, a byte-identical check on one of them proves nothing about the other.
- **`click` has only ever been tested on things that do not navigate.** Every click check in the
  self-test drives a button that rewrites the page in place, and back/forward go through
  `Page.navigateToHistoryEntry`, not the mouse — so 27/27 and 155 unit tests were all silent
  while clicking an ordinary `<a href>` did nothing on a real site. **A test that only exercises
  the half of a tool that its fixture happens to contain is worth less than its pass count
  suggests.** The fixture now carries a link for exactly this reason.
- **`about:blank` is not `DRIVABLE`.** `DRIVABLE` is `/^(https?|file):/`, so a tab parked on
  about:blank drops out of the `tabs` listing entirely and takes its `*` marker with it — the
  agent cannot see the tab it is attached to. Parking there between runs is still the right way
  to make two measurements start from the same prompt; just do not read the missing star as a
  lost attachment.
- **A "did it navigate?" check needs a discriminator that cannot be true on both pages.** Testing
  HN's comments link by looking for `[link] "N comments"` proves nothing: the item page carries
  one too. Counting them (29 on the front page, 1 on an item page) is the version that works.
  The first run of this test reported a false negative and nearly buried the click defect.
- **Opening a tab is a side effect, and the panel does it on every Run.** `pickTab()` created an
  active `about:blank` whenever nothing drivable was open, and the pre-Run re-attach called it
  before the model had asked to go anywhere — so Run from a fresh window meant staring at a black
  page under a debugger banner for a whole turn. Same rule as `currentPage()`, which was already
  written this way: **building a prompt must not have side effects.** Only a caller about to
  drive a tab may open one.
- **Anything that reads relayed page text has to handle a PATCH, not just a page.** The gate was
  the one that mattered — it replaced its ref→label map wholesale, and a patch names only what
  changed, so a form fill would have left it blind to the Submit button it exists to catch. Any
  future consumer of page text inherits this: ask whether the text starts with `UNCHANGED` before
  treating it as the whole page.
- **A threshold expressed as a FRACTION of the page cannot measure a fixed-size response.** An
  unchanged re-read is always the same 97-char marker, so `again.length < first.length / 4` is
  really asking "is the fixture bigger than 388 chars?" — it passes or fails on the size of the
  page, not on anything the delta did. Cost a FAIL on a live self-test run where the code was
  perfect. Same family as the gotcha below, from the opposite direction: one needs a big enough
  page to produce a delta at all, this one needs a big enough page for a ratio to mean anything.
  When the thing under test is a constant, assert on the constant.
- **A delta test needs a realistically sized page.** Two- and three-line fixtures never produce
  one — a single changed line is already over the 40% bar — so a test written on a small page
  silently exercises the full-page path and proves nothing about deltas. Cost two rounds of
  confusing failures; the fixtures are ten controls now for exactly this reason.
- **"The model said it twice" is a dedup bug, not a model bug.** Both CLIs send the final message
  as an assistant event and again as the result summary, so the panel has always had to drop one.
  It compared against the **latest** assistant text, which silently stops working the moment the
  model says anything after its answer — a sources line, a sign-off — or splits a long answer
  across two events. Compare against **everything said this run**, not the last thing.
- **Tab groups multiply unless the id is per RUN and checked before reuse.** Chrome deletes a
  group when its last tab closes, and there is no "does this exist" call — `tabGroups.get` on a
  dropped id rejects, and that rejection IS the check. Without it a stale id throws on every
  later open for the rest of the session; without one id per run you get a group per tab, which
  is the shape of the four bug reports that got this feature rejected the first time.
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
