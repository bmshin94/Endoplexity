# Security policy

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** — the Security tab of this
repository, "Report a vulnerability". That keeps the report private until
there is a fix. Please do not open a public issue for anything exploitable.

Expect a first reply within a week. This is a `v0.0.1` project maintained by
one person, so that is a good-faith target, not an SLA.

## What this software actually does

Worth stating before you assess a finding, because the threat model is unusual:
Endoplexity drives **your real Chrome profile, already logged into your real
accounts**. It is not an isolated automation browser. An agent acting through
it acts as you.

The trust boundary is deliberately small:

- The bridge binds `127.0.0.1` and nothing else.
- The WebSocket upgrade is accepted only from the pinned extension origin,
  derived at load time from the RSA `key` in `extension/manifest.json`.
- `/mcp`, which a CLI reaches with no `Origin` header, is gated by a token in a
  gitignored `0600` file that is never passed on a command line.
- The agent CLIs run with browser tools and nothing else — shell, write and
  fetch are denied, and this was verified by trying them, not by reading docs.
- `upload` and `read_file` resolve a key from `.endo-files.json`. The model
  never sees or supplies a filesystem path.

## In scope

- Anything that reaches the bridge from outside loopback, or from a web page,
  or from another extension.
- Any way a model-supplied string reaches the filesystem, a shell, or a path
  outside the `.endo-files.json` allow-list.
- Any way to bypass the approval gate on an irreversible action, or to reach
  `trust` mode without the human selecting it.
- Any way page content can execute script in the side panel. The panel renders
  model output *and* text scraped from arbitrary websites, so this is the
  sharpest edge in the codebase.
- Token or `.endo-files.json` contents leaking into logs, argv, or the repo.

## Known and accepted

These are documented design limits, not vulnerabilities. A report that
restates one is welcome as a discussion, not as a security issue:

- **The approval gate is a label heuristic.** It matches the clicked element's
  visible label against a list of English words. Non-English labels, unusual
  wording, and icon-only buttons are not caught. See `bridge/src/gate.ts`.
- **`trust` mode disables the gate.** That is what it is for. The panel shows
  it in red the whole time it is set.
- **`read_file` puts file contents in the model's context**, unlike `upload`.
  The allow-list is the entire boundary. This widening is deliberate and
  recorded.
- **`0600` does not mean on Windows what it means on POSIX.** Node's `mode`
  only toggles the read-only attribute there; it does not restrict the file to
  its owner. Anything running as your user can read the token regardless — and
  anything running as your user could drive Chrome directly anyway.
- **Sessions live in the bridge's memory and die with it.** By design.
