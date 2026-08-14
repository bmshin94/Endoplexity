<div align="center">

<img src="extension/icons/icon-128.png" width="72" alt="Endoplexity">

# Endoplexity

**Agentic browser control, driven by the AI subscription you already pay for.**

A Chrome side panel that reads and acts on the page you are actually looking at —
click, type, fill forms, move between tabs — through your existing `claude` or
`cursor-agent` CLI instead of a metered API key.

[![Licence](https://img.shields.io/badge/licence-Apache--2.0-1f6f4a)](LICENSE)
[![Node](https://img.shields.io/badge/node-24%2B-1f6f4a)](package.json)
[![Tests](https://img.shields.io/badge/tests-156%20passing-1f6f4a)](bridge/test)
[![API key](https://img.shields.io/badge/API%20key-not%20required-1f6f4a)](#what-it-costs)

<img src="docs/demo.gif" width="100%" alt="Endoplexity opening three pricing pages in separate tabs and comparing their free tiers in one table">

<sub>Real time, no cuts beyond a trim and a speed-up · <a href="docs/demo.mp4">full-quality video</a></sub>

</div>

---

## What you just watched

One instruction: *"Open the pricing pages for Vercel, Netlify and Cloudflare
Pages in three tabs, then compare their free tiers in one table."*

It opened three tabs, read each pricing page, followed a plan link that lived on
another page entirely, noticed when a link took it somewhere unexpected and
recovered, and came back with a comparison table, the sources it actually used,
and a takeaway naming the trade-off between Cloudflare's unlimited static
bandwidth and Netlify's credit cap.

That banner reading *"Endoplexity started debugging this browser"* is Chrome's,
and it stays up the whole time. This is your real browser, your real session, on
the pages you were already looking at — not a headless copy that has to log in
again.

## Why this exists

Every open-source Comet clone needs an API key and burns metered credits. But if
you pay for Claude or Cursor, a tool-calling agent loop is already sitting on
your machine, idle, fully paid for.

So the brain didn't need writing. What was missing was **hands** — a browser it
can touch — and a **face** — a panel that shows the work. That is all this is: a
tool server and a UI. The agent loop is the CLI you already have.

## How it works

The extension never talks to a model. The CLI never talks to Chrome. Neither one
holds the other's credentials.

```
┌──────────────────────┐   WebSocket    ┌──────────────┐    MCP/HTTP   ┌──────────────────┐
│  Chrome side panel   │  origin-pinned │ local bridge │  token-gated  │  claude -p       │
│  (MV3)               │◄──────────────►│  127.0.0.1   │◄─────────────►│  cursor-agent -p │
│  owns chrome.debugger│                │  :8787       │               │  (the agent loop)│
└──────────────────────┘                └──────────────┘               └──────────────────┘
```

The panel owns the CDP connection rather than the service worker, which sidesteps
MV3 idle teardown. The bridge exposes 14 browser tools over MCP and is where the
safety policy lives — never in a prompt, so nothing the model says can widen its
own permissions.

**Tools** — `snapshot` `navigate` `click` `type` `key` `upload` `read_file`
`select` `scroll` `hover` `back` `forward` `tabs` `use_tab`

Two decisions do most of the work:

- **Pages go to the model as an accessibility-tree snapshot, not raw HTML.** It is
  what the model needs and a fraction of the bytes.
- **Actions return the page they produced**, so acting and re-reading are one turn
  instead of two — and after the first read, only the lines that changed.

`read_file` reads a configured document as text — pdf, docx, xlsx, pptx, csv,
json, markdown, or any text file — so the agent can answer questions *about* an
attachment instead of only pushing it at a form field.

## Quick start

```bash
npm install
npm run setup          # starts the bridge at login — no terminal, no token to copy
npm run cursor-login   # once, and only if you want the Cursor models
```

Then `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `extension/`.

Open the side panel, type a task, press **Run**. `Enter` starts a fresh task;
`ctrl`/`cmd`+`Enter` replies to the running conversation. Type `@` to hand the
agent another open tab.

To let the agent attach or read files, copy `.endo-files.example.json` to
`.endo-files.json` and add your paths. The model names a key from that file and
never sees a path.

### Requirements

- Node **24+**
- Chrome **114+** (135+ for the themed dropdowns; older Chrome falls back to native)
- A **Claude** subscription — **Pro is enough, not just Max** — with the `claude`
  CLI, and/or a **Cursor** subscription with `cursor-agent`

Claude Code runs on Pro and Max alike. On Pro, pick Sonnet in the model dropdown:
this work is snapshot-read-click, which is not what you need a frontier reasoning
model for.

## The safety model

This drives a browser logged into your real accounts, so the boundaries are worth
stating plainly — including where they stop.

- **Loopback only.** The bridge binds `127.0.0.1`, never `0.0.0.0`.
- **The panel is identified by origin, not a shared secret.** The extension ID is
  pinned by an RSA `key` in the manifest, and the WebSocket upgrade must match
  exactly that origin — page script cannot forge an `Origin` header. The `/mcp`
  endpoint, which a CLI reaches with no origin, is gated by a token in a `0600`
  gitignored file, never passed on a command line.
- **The agent gets browser tools and nothing else.** Claude runs with an explicit
  allowlist plus `--strict-mcp-config --setting-sources ""`; Cursor runs in an
  isolated profile with `Shell`, `Write`, `Read` and `WebFetch` denied. Both were
  verified by trying to run a shell command, not by reading documentation.
- **Irreversible actions stop for a human.** Submitting, deleting and purchasing
  hit an approval gate that lives in the bridge. Silence denies. A disconnected
  panel denies.
  **Know exactly what that check is:** it matches the clicked element's visible
  label against a list of English words (`submit`, `pay`, `delete`, `confirm`, …).
  It is a label heuristic, not an understanding of the page. A button labelled in
  another language, worded unusually ("Finish", "Yes, place it"), or carrying an
  icon and no text will **not** be caught. Use `watch` mode where that matters.
- **Three autonomy modes** — `watch` / `normal` / `trust` — chosen in the panel and
  enforced in the bridge. An absent or unrecognised mode is `normal`, never
  `trust`: it fails closed. `trust` disables the gate, so the panel shows it in red
  the entire time it is set. *(The demo above runs in `trust`, which is why you
  never see the gate fire.)*
- **Files resolve a configured key, never a model-supplied path.**
  `DOM.setFileInputFiles` runs in the browser process and can read anything, so a
  model-chosen path would be an exfiltration primitive. Note the asymmetry:
  `upload` hands a file to a page without the model seeing its contents, but
  `read_file` puts those contents *in the model's context*. That allow-list is the
  whole boundary — put only what you mean to share in it.

Found a hole? [SECURITY.md](SECURITY.md) — please report privately.

## What it costs

A complete job application, filled agent-driven on a real Greenhouse form:

| | |
|---|---|
| Cost | **$0.0959** |
| Tokens | 112,064 |
| Turns | 10 |
| Wall clock | 42s |

That dollar figure is what the CLI reports as *equivalent* API spend. On a
subscription it is covered by the subscription, which is the entire point.

The same task measured flat against a 5-tool baseline while carrying ~18k tokens
more tool schema — so going from 5 tools to 13 cost nothing per run. Page returns
were later cut **3.8×** by sending a page once and then only the lines that
changed: 119,856 → 31,626 tokens on a ten-turn Hacker News task.

## Status

Early — `v0.0.1`, and honest about it. The tool layer, approval gate, session
continuity and panel are built and tested: **156 unit tests**, plus an in-panel
self-test that drives the real CDP layer against a cross-origin fixture
(`await endo.selftest()` in the panel console).

Known gaps:

- **Windows-first.** `npm run setup` installs autostart via a Startup-folder
  script; macOS and Linux autostart are not implemented. The bridge itself is
  portable — `npm start` works anywhere.
- **Sessions live in the bridge's memory.** Restarting it ends resumability, by
  design: resuming into a Chrome that has moved on would hand the agent a
  transcript full of stale element references.
- Real ATS comboboxes are not `<select>` elements, so they need click-then-click
  rather than the `select` tool.
- `chrome://` pages and the Web Store cannot be driven — Chrome refuses the
  debugger there.
- After many navigations, dead out-of-process iframe sessions can leave a line of
  noise in snapshots.

## Development

```bash
npm test     # 156 tests, node:test, no framework, no build step
npm start    # run the bridge in the foreground to watch its log
```

There is no bundler and no framework — the extension is plain HTML and JS, and
the bridge is TypeScript run directly by Node 24.

`docs/handrun.md` is the manual verification checklist. `PRODUCT.md` and
`DESIGN.md` are the product and interface briefs the panel was built against.

## Licence

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for trademark attribution.

> Independent project. Not affiliated with, endorsed by, or sponsored by
> Perplexity AI, Anthropic, or Anysphere.
