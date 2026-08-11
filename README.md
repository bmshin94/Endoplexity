# Endoplexity

Agentic browser control driven by the AI subscriptions you already pay for.

A Chrome side panel that lets Claude or Cursor read and act on the page you are
actually looking at — click, type, fill forms, move between tabs — using your
existing `claude` or `cursor-agent` CLI instead of a metered API key.

> Independent project. Not affiliated with, endorsed by, or sponsored by
> Perplexity AI, Anthropic, or Anysphere. See [NOTICE](NOTICE).

## How it works

The extension never talks to a model. The CLI never talks to Chrome. Neither one
has the other's credentials.

```
┌──────────────────────┐   WebSocket    ┌──────────────┐    MCP/HTTP   ┌──────────────────┐
│  Chrome side panel   │  origin-pinned │ local bridge │  token-gated  │  claude -p       │
│  (MV3)               │◄──────────────►│  127.0.0.1   │◄─────────────►│  cursor-agent -p │
│  owns chrome.debugger│                │  :8787       │               │  (the agent loop)│
└──────────────────────┘                └──────────────┘               └──────────────────┘
```

The panel owns the CDP connection, not the service worker — which sidesteps MV3
idle teardown. The bridge exposes 14 browser tools over MCP and is where the
safety policy lives. Because it drives `chrome.debugger` from inside your own
browser, it works on your already-logged-in profile: no separate automation
browser, no re-authenticating to every site.

**Tools:** `snapshot` `navigate` `click` `type` `key` `upload` `read_file`
`select` `scroll` `hover` `back` `forward` `tabs` `use_tab`

`read_file` reads a configured document as text — pdf, docx, xlsx, pptx, csv,
json, markdown, or any text file — so the agent can answer questions about an
attachment rather than only pushing it at a form field. Like `upload` it takes a
key from `.endo-files.json`, never a path.

Pages are sent to the model as an accessibility-tree snapshot, not raw HTML, and
actions return the page they produced — so acting and re-reading are one turn
instead of two.

## Requirements

- Node **24+**
- Chrome **114+** (135+ for the themed dropdowns; older Chrome falls back to the
  native ones)
- A **Claude** subscription — **Pro works, not just Max** — with the `claude`
  CLI, and/or a **Cursor** subscription with `cursor-agent`

Claude Code runs on Pro and Max alike, so the cheaper plan is enough to drive
this. Pro's usage limits are lower, and Opus access depends on your plan, so on
Pro pick Sonnet in the model dropdown; the browser work is
snapshot-read-click, which is not what you need a frontier reasoning model for.

## Install

```bash
npm install
npm run setup          # starts the bridge at login — no terminal, no token to copy
npm run cursor-login   # once, and only if you want the Cursor models
```

Then load the extension: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select `extension/`.

Open the side panel, type a task, press **Run**. `Enter` starts a fresh task,
`ctrl`/`cmd`+`Enter` replies to the running conversation.

To let the agent attach files (a résumé, say), copy
`.endo-files.example.json` to `.endo-files.json` and add your paths.

## The safety model

This drives a browser that is logged into your real accounts, so the boundaries
are worth stating plainly.

- **Loopback only.** The bridge binds `127.0.0.1`, never `0.0.0.0`.
- **The panel is identified by origin, not a shared secret.** The extension ID is
  pinned by an RSA `key` in the manifest, and the WebSocket upgrade is matched
  against exactly that origin — page script cannot forge an `Origin` header. The
  `/mcp` endpoint, which a CLI reaches without any origin, is gated by a token
  held in a `0600` gitignored file and never passed on a command line.
- **The agent gets browser tools and nothing else.** Claude runs with an explicit
  allowlist plus `--strict-mcp-config --setting-sources ""`; Cursor runs in an
  isolated profile with `Shell`, `Write`, `Read` and `WebFetch` denied. Both were
  verified by trying to run a shell command, not by reading documentation.
- **Irreversible actions stop for a human.** Submitting, deleting, purchasing and
  similar hit an approval gate that lives in the bridge — never in a prompt — so
  nothing the model says can widen its own permissions. Silence denies. A
  disconnected panel denies.
- **Three autonomy modes** (`watch` / `normal` / `trust`), chosen in the panel and
  enforced in the bridge. An absent or unrecognised mode is `normal`, never
  `trust`: it fails closed. `trust` disables the gate, so the panel shows it in
  red the entire time it is set.
- **Uploads resolve a configured key, never a model-supplied path.** `DOM.setFileInputFiles`
  runs in the browser process and can read anything, so the model never sees a
  filesystem path at all.

## What it costs

A complete job application, filled agent-driven on a real Greenhouse form:

| | |
|---|---|
| Cost | **$0.0959** |
| Tokens | 112,064 |
| Turns | 10 |
| Wall clock | 42s |

That dollar figure is what the CLI reports as equivalent API spend — on a
subscription it is covered by the subscription, which is the entire point. The
same task measured flat against a 5-tool baseline while carrying ~18k tokens
more tool schema, so going from 5 tools to 13 cost nothing per run.

## Status

Early — `v0.0.1`, and honest about it. The tool layer, the approval gate, session
continuity and the panel are built and tested (106 unit tests, plus an in-panel
self-test: open the panel's console and run `await endo.selftest()`).

Known gaps:

- **Windows-first.** `npm run setup` installs autostart via a Startup-folder
  script; macOS and Linux autostart are not implemented (the bridge itself is
  portable — `npm start` works anywhere).
- **Sessions live in the bridge's memory.** Restarting it ends resumability, by
  design: resuming into a Chrome that has moved on would hand the agent a
  transcript full of stale element references.
- Real ATS comboboxes are not `<select>` elements, so they need click-then-click
  rather than the `select` tool.
- `chrome://` pages and the Web Store cannot be driven — Chrome refuses the
  debugger there.
- After many navigations, dead out-of-process iframe sessions leave a line of
  noise in snapshots.

## Development

```bash
npm test     # 106 tests, node:test, no framework
npm start    # run the bridge in the foreground to watch its log
```

`docs/handrun.md` is the manual verification checklist. `PRODUCT.md` and
`DESIGN.md` are the product and interface briefs the panel was built against.

## Licence

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for trademark attribution.
