# CometClone — phase state

Agentic browser control (Comet clone) driven by **existing Claude Max and Cursor
subscriptions** instead of metered API keys. Design doc: `docs/specs/design.md`.

**Shape:** Chrome side panel (MV3) → local Node bridge → `claude -p` / `cursor-agent -p`.
The bridge exposes browser tools over MCP; the CLIs are the agent loop. The extension
never talks to a model, the CLI never talks to Chrome.

---

## Current: Phase 0 complete ✅ (2026-07-31)

Scaffold + authenticated WebSocket handshake.

**Built**
- `bridge/src/index.ts` — HTTP+WS server, loopback only, token file bootstrap, ping→pong
- `bridge/src/auth.ts` — upgrade gate (extension origin AND timing-safe token)
- `extension/` — MV3 manifest, `sw.js` (opens panel on action click), `panel.html` + `panel.js` (WS client, token setup, ping button)
- `bridge/test/auth.test.ts` — 4 tests

**Verified (run, not assumed)**
- `npm test` → 4/4 pass
- Upgrade path via curl: web origin + valid token → **401**; extension origin + wrong token → **401**; extension origin + no token → **401**; extension origin + valid token → **101**
- `netstat` → `TCP 127.0.0.1:8787 LISTENING`, no 0.0.0.0 bind

- Live browser round trip: extension loaded unpacked (ID `dcknfpbmkbobhgjfblfmmogochjjkcha`),
  panel connected, `ping` → `pong` in **11ms**. Confirmed from both sides — panel log and
  bridge log (`panel connected`, no preceding `refused` line).

**Deviation from the design doc (deliberate)** — the doc says validate the upgrade Origin
against a specific `chrome-extension://<id>`. Not implemented, and not planned. The token
already stops every realistic attacker: web pages are blocked by the origin scheme check,
and other extensions or local processes can forge an Origin header but cannot read
`.comet-token` off disk. Pinning the ID would add a config knob whose only failure mode is
a silent refusal when the unpacked folder moves. Revisit only if this is ever packed and
distributed.

**Known issue (open)** — `.comet-token` is written with `mode: 0o600` but Windows shows
`-rw-r--r--`; POSIX modes are ignored here, file ACLs govern instead. Low risk on a
single-user machine. Revisit only if this ever runs on a shared box.

---

## Next: Phase 1 — CDP tool layer

Drive the page from `panel.js` via `chrome.debugger`. **No model involved yet.**

Order of work:
1. `attach(tabId)` + `Target.setAutoAttach({autoAttach:true, flatten:true})` — **do this first**, OOPIF support is not retrofittable
2. `snapshot` — `Accessibility.getFullAXTree` per frame target, filtered to interactive + text nodes, refs namespaced per frame (`@f1e7`)
3. `click` / `type` / `key` — `DOM.getBoxModel` → `Input.dispatch*Event` (trusted events so React `onChange` fires)
4. Stale-ref rejection: refs die on navigation or DOM mutation

**Done when:** a hand-run script snapshots a real Greenhouse form (form lives in a
cross-origin iframe), fills 3 fields, clicks — screenshot in this file.

---

## Remaining phases

| # | Deliverable | Done when |
|---|---|---|
| 2 | MCP server + Claude adapter | `claude -p "search google for X, open first result"` completes unattended |
| 3 | Panel UI + live step streaming | Steps render as they happen; Stop kills the child process |
| 4 | Approval gate | Submit-labelled click blocks in the **bridge**; approve/stop/60s-timeout-deny |
| 5 | Cursor adapter + model picker | Same task on Grok 4.5 and Composer 2.5 |
| 6 | **v1 — form-fill hardening** | "Apply with my resume" on **3 real job sites**, incl. upload + multi-page + gated submit |
| 7 | Multi-tab research | "Compare these 5 laptops" → table in panel |

Phase 6 is the ship line.

---

## Decisions locked

- **Side panel + local bridge**, not a Chromium fork and not a separate web UI
- **`chrome.debugger` from the extension**, not external CDP — no `--remote-debugging-port` relaunch, uses the already-logged-in profile
- **Auto-run, gate irreversible actions** — gate lives in the bridge, never in a prompt
- **Panel owns the WebSocket and CDP**, not the service worker — side panels have full API access and dodge MV3 idle teardown
- **No build step yet** — plain HTML/JS extension. Add Vite + React only if Phase 3 actually needs it.

## Security invariants (do not regress)

- Bind `127.0.0.1` only
- Both origin **and** token required on WS upgrade
- CLIs spawn with `--allowedTools "mcp__comet__*" --disallowedTools Bash Edit Write Read` — otherwise "fill this form" has a shell behind it
- No `--dangerously-skip-permissions`

## Run it

```bash
npm install
npm start                    # prints the token
npm test
```
Then `chrome://extensions` → Developer mode → Load unpacked → `extension/`, open the
side panel, paste the token once.
