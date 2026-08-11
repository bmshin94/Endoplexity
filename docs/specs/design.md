# Endoplexity — agentic browser control on your own subscriptions

## Context

**The problem.** Perplexity Comet and every open-source clone of it (nanobrowser 13.5k⭐, browser-use, BrowserKing, tabagent, webpilot) share one flaw: they need an API key and burn metered credits. Meanwhile two agentic loops are already paid for and idle on this machine — Claude (Pro or Max) via the `claude` CLI, and Cursor (Composer 2.5 / Grok 4.5) via `cursor-agent`. Both run headless, both emit structured NDJSON, both speak MCP.

**The insight.** The brain does not need to be written. `claude -p` *is* a tool-calling agent loop. What is missing is **hands** (a browser it can touch) and a **face** (a panel showing the work). So this is a thin shell — a tool server and a UI — not an agent framework.

**Outcome.** A Chrome side panel docked in the real, logged-in browser. Type "apply to this job with my resume"; watch it read the page, fill fields, upload the resume, page through, pause for one click before submitting. Model picker switches Claude ↔ Cursor. Zero API spend.

**Repo state.** `c:\Users\venni\Endoplexity` is empty. Greenfield, not yet a git repo.

**Decisions locked** (all four confirmed): Chrome side panel + local bridge · `chrome.debugger` CDP from the extension · auto-run with gates on irreversible actions · v1 = form-fill, then multi-tab research.

---

## Architecture

```
┌─ Chrome (real profile, your logins) ─────────────────────────┐
│  side panel (React)  ←──  service worker  ──chrome.debugger──┼──▶ active tab
└──────────┬───────────────────────┬───────────────────────────┘
           │ WS (token-authed, 127.0.0.1 only)
           ▼                       ▼
┌─ bridge — one Node process, localhost:8787 ──────────────────┐
│  WS server ──── panel events + CDP command relay             │
│  MCP server (Streamable HTTP, /mcp) ──── browser tools       │
│  approval gate ──── blocks tool response until user clicks   │
│  CLI adapters ──── spawn + normalize NDJSON                  │
└──────────┬───────────────────────────────────────────────────┘
           ├── claude -p --output-format stream-json --mcp-config … 
           └── cursor-agent -p --output-format stream-json --model grok-4.5
```

**One request, end to end:** panel sends task → bridge spawns the chosen CLI with `--mcp-config` pointing at its own `/mcp` → CLI calls `snapshot` → MCP handler relays over WS to the service worker → `chrome.debugger` runs CDP → result returns up the same path → CLI reasons, calls `click` → gate checks it → panel renders each step live from the NDJSON stream.

The bridge is the only process that talks to both sides. The extension never talks to a model; the CLI never talks to Chrome.

### Why this shape
- The agent loop, retries, context management, and prompt caching are Anthropic's and Cursor's problem, not ours.
- MCP is the one tool layer both brains already speak — write the browser tools **once**, both models get them.
- CDP from inside the extension means no `--remote-debugging-port` relaunch and no separate browser profile; it drives the Chrome that is already signed into LinkedIn, Gmail, and everything else.

---

## Repo layout

```
Endoplexity/
  extension/        MV3 — manifest, service worker (CDP), side panel (React)
  bridge/           Node — ws, MCP http server, cli adapters, approval gate
  shared/           TS types for events + tools, imported by both
  PHASE-STATE.md    phase tracker (per global workflow rules)
```

**Stack:** TypeScript · Vite + `@crxjs/vite-plugin` (MV3) · React (panel only) · Node 24 (installed) · `ws` · `@modelcontextprotocol/sdk`. Nothing else — no state library, no CSS framework, no test framework beyond `node:test`.

---

## Tool surface (the entire API — keep it here)

| Tool | CDP behind it | Notes |
|---|---|---|
| `snapshot` | `Accessibility.getFullAXTree` | Returns numbered refs: `@e1 [button] "Submit"`. The load-bearing tool. |
| `click(ref)` | `DOM.getBoxModel` → `Input.dispatchMouseEvent` | Real trusted event at element center. |
| `type(ref, text)` | `Input.dispatchKeyEvent` per char | Trusted keystrokes so React `onChange` fires. |
| `select(ref, value)` | `Runtime.callFunctionOn` + `change` event | Native `<select>` only. |
| `key(name)` | `Input.dispatchKeyEvent` | Enter, Tab, Escape. |
| `upload(ref, path)` | `DOM.setFileInputFiles` | Non-negotiable for job applications. |
| `navigate(url)` / `back` | `Page.navigate` | |
| `scroll(dir)` / `scroll_to(ref)` | `Input.dispatchMouseEvent` wheel | |
| `read_text` | `Runtime.evaluate` innerText | Cheap path for research; snapshot is for acting. |
| `screenshot` | `Page.captureScreenshot` | Vision fallback when the AX tree is empty (canvas apps). |
| `tabs` / `new_tab` / `switch_tab` / `close_tab` | `chrome.tabs` | Multi-tab research. |
| `wait(ms)` | — | Plus implicit network-idle wait after navigate/click. |

Refs are stable only within one snapshot; every navigation or DOM mutation invalidates them. The tool descriptions must say so, or the model will reuse stale refs — this is the single most common failure mode in every clone surveyed.

### The two traps that decide whether this works on real sites

1. **Cross-origin iframes.** Greenhouse, Lever, and Workday embed their forms in OOPIFs. `Accessibility.getFullAXTree` on the main frame returns *nothing* for them. Fix: `Target.setAutoAttach({autoAttach: true, flatten: true})` at attach time, snapshot every attached frame target, and namespace refs per frame. Build this in Phase 1, not later — retrofitting it means rewriting the ref system.
2. **AX tree size.** A full LinkedIn tree is tens of thousands of nodes and will blow the context window. Filter to interactive + text-bearing nodes, drop anything outside the viewport unless asked, cap the payload, and paginate. Reference implementation: `nanobrowser/nanobrowser` (Apache-2.0) — study their serializer, do not vendor their code.

---

## Approval gate

Enforced in the **bridge**, never by prompting the model — a model instructed to ask nicely will eventually not ask.

Before executing, the handler matches the resolved element's accessible name against a user-editable regex list (`submit|pay|buy|send|delete|confirm|order|checkout|apply now`), plus any navigation to an OAuth consent URL. On match, the bridge pushes `approval_request` to the panel and the MCP tool handler `await`s a promise that only the panel's reply resolves. Timeout (60s) → auto-deny with a clear tool error so the model can react rather than hang.

Everything else — reading, navigating, scrolling, typing — runs unattended.

---

## Security (v1, not deferred)

These are the parts not to be lazy about. A local WebSocket that drives a logged-in browser is a genuine hole.

- Bridge binds `127.0.0.1` only. Never `0.0.0.0`.
- Random token generated on first run, stored in `chrome.storage.local`, required on WS upgrade — otherwise any web page you visit can `new WebSocket("ws://localhost:8787")` and drive your bank tab.
- Validate `Origin` on upgrade against `chrome-extension://<id>`.
- **Spawn the CLIs with browser tools only**: `--allowedTools "mcp__endo__*"` together with `--disallowedTools Bash Edit Write Read`. Without this, "fill out this form" has a filesystem and a shell behind it.
- Resume path is an explicit allow-list of directories, never arbitrary model-chosen paths.
- No `--dangerously-skip-permissions`.

---

## Model routing

Panel dropdown → bridge picks a spawn line. One adapter per CLI (~60 lines each) normalizing NDJSON to a shared event type in `shared/`:

```
claude   → claude -p --model opus-5|sonnet-5 \
             --output-format stream-json --include-partial-messages \
             --mcp-config '{"mcpServers":{"endo":{"type":"http","url":"http://127.0.0.1:8787/mcp"}}}' \
             --allowedTools "mcp__endo__*" --disallowedTools Bash Edit Write Read
cursor   → cursor-agent -p --model composer-2.5|grok-4.5 --output-format stream-json
```

Cursor reads MCP servers from `~/.cursor/mcp.json`; the bridge writes its entry there on first run. `cursor-agent` is **not installed yet** — Phase 5 installs it and verifies Windows support before any code is written against it. If Windows support turns out to be missing, Claude-only still ships everything through Phase 4 and the panel hides the Cursor option.

Both CLIs support `--resume <session_id>`; the bridge stores it per conversation so follow-ups ("now do the same on the next posting") keep context. Every task prompt is prefixed with the active tab's URL and title so "this page" resolves.

---

## Phases

Each phase ends with a check that actually runs. Per the global build protocol: Opus plans and verifies, Sonnet subagents implement, `PHASE-STATE.md` updated and committed at each close.

| # | Deliverable | Done when |
|---|---|---|
| 0 | `git init`, scaffold, WS handshake | Panel opens in Chrome, round-trips `ping`→`pong` through the bridge |
| 1 | CDP tool layer incl. OOPIF + AX filtering | A hand-run script snapshots a Greenhouse form, fills 3 fields, clicks — no model involved |
| 2 | MCP server + Claude adapter | `claude -p "search google for X and open the first result"` completes unattended |
| 3 | Side panel UI + live step streaming | Steps, tool calls, and text render as they happen; Stop button kills the child process |
| 4 | Approval gate | Submit-labelled click blocks; Approve proceeds, Stop aborts, 60s timeout denies |
| 5 | Cursor adapter + model picker | Same task completes on Grok 4.5 and Composer 2.5; switching mid-conversation works |
| 6 | **v1 — form-fill hardening** | "Apply with my resume" completes on **3 different real job sites**, incl. upload + multi-page + gated submit |
| 7 | Multi-tab research | "Compare these 5 laptops" opens tabs, extracts, renders a table in the panel |

Phase 6 is the ship line. Phase 7 is nearly free once the tools exist — it is read-only use of the same surface.

---

## Verification

- **Per-tool:** `node:test` against a local fixture page in `bridge/test/fixtures/` covering ref resolution, stale-ref rejection, and OOPIF traversal. No mocking of CDP — run real Chrome headed.
- **Gate:** unit test that a `submit`-named click never reaches the CDP layer without an approval message.
- **Security:** a test asserting the WS upgrade is rejected without a valid token and with a wrong `Origin`.
- **End to end (the real check):** open a live job posting, type the task in the panel, watch it. Phase 6 is not done on one site — three sites, screenshots of each, recorded in `PHASE-STATE.md`.
- **Honesty rule:** no phase is reported complete without its check having been run, output pasted verbatim.

---

## Known ceilings (deliberate, revisit only if hit)

- `Input.dispatchKeyEvent` per character is slow on long text — batch to `Input.insertText` above ~200 chars if typing latency becomes annoying.
- Canvas-only apps (Figma, Google Docs body) degrade to screenshot + coordinate clicking; accept lower reliability there.
- CAPTCHAs are not solved and will not be — the gate surfaces them for manual handling.
- The `chrome.debugger` yellow "DevTools is debugging this browser" banner cannot be suppressed. It is the price of trusted input events.
- Single active task at a time. Parallel tasks across tabs only if it is actually wanted later.

## Out of scope for v1

Cloud sync, multi-browser (Firefox/Safari), a forked Chromium, scheduled/background tasks, mobile, and any packaging for distribution to other people. This is a personal tool first.
