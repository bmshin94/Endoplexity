# Launch assets

Working copy for the launch. Not part of the software.

## LinkedIn post — v2, written against the recorded demo (2026-08-14)

> Attach `docs/demo.mp4`. LinkedIn strips markdown, so this is written to read
> correctly as plain text. The v1 draft is kept below it for reference.

---

I built a browser agent that runs on the AI subscription I already pay for, instead of a metered API key.

It's a Chrome side panel. You point it at the page you're on and say what you want. In the video it opens three pricing pages in three tabs, reads all of them, chases a plan link that turned out to live on a different page entirely, and comes back with a comparison table and the sources it actually used.

It drives your real browser, already signed into your real accounts. That "started debugging this browser" banner is Chrome's, and it stays up the whole time. No separate automation browser, no logging back into everything.

The part I didn't have to build was the brain. `claude -p` is already a tool-calling agent loop, fully paid for, sitting idle on my machine. What was missing was hands and a face.

Four things I got wrong. That's where the engineering actually was.

1. Mouse events don't cross iframe boundaries.

I kept sending clicks to the page's main debugger session with translated coordinates. The submit button did nothing. Events sent to the main session are hit-tested by the root renderer and never enter a cross-origin iframe — and every serious job application form is one. Mouse events have to go to the element's own session. There is no coordinate translation anywhere, which was the exact opposite of what I'd built.

2. The worst bug looked identical to success.

The agent filled a Greenhouse application perfectly. Every tool call returned success. Every value landed. None of it on the tab I was watching — it had bound to a tab at startup and never re-bound. A tool that reports success against the wrong target is worse than one that crashes.

3. I built a pairing endpoint, then deleted it.

The panel had to prove it was really my extension, so I wrote an HTTP endpoint to hand it a token. It refused its own panel: Chrome sends no Origin header at all on fetch() from an extension page. But the WebSocket upgrade does carry one, and page script cannot forge it. So identity moved onto the socket and the token left that path entirely. The best code I wrote that week is code that isn't there.

4. I spent a phase fixing a bug that did not exist.

Clicking links stopped working. I had a tidy theory about coordinate spaces. I finally measured it instead of believing it: the theory was wrong, and every link clicked fine. The real cause was that Chrome keeps serving the extension it cached until you explicitly reload it, so I'd been testing a build from days earlier — one whose element references renumbered themselves whenever the page changed underneath them. The clicks were landing on the wrong elements.

The evidence had been sitting in my own bug report the entire time. The reference numbers I'd pasted were in the old format. I just never read them as data.

On letting a model click things: submit, delete and purchase stop and ask. That gate lives in the bridge, never in a prompt, so nothing the model says can widen its own permissions. Silence denies. It is also a keyword match on button labels rather than real comprehension — which is stated plainly in the README, because a safety feature you have oversold is worse than one you never shipped.

A complete job application: 10 turns, 42 seconds, $0.0959 of equivalent API spend — covered by the subscription, which was the whole point.

Open source, Apache-2.0.

github.com/Endokelp/Endoplexity

#buildinpublic #chromeextension #ai

---

## LinkedIn post — v1 (superseded, kept for the phrasing)

I spent the last few weeks building a browser agent that runs on the AI subscription I already pay for, instead of a metered API key.

It's a Chrome side panel. You point it at whatever page you're on and tell it what to do — fill this form, compare these pricing tiers, find where they hid the docs. It drives your real browser, already logged into your real accounts. No separate automation browser, no re-authenticating to everything.

Three things I got wrong first. That's where the actual engineering was.

1. Mouse events don't cross iframe boundaries.

I kept sending clicks to the page's main debugger session with translated coordinates. The submit button did nothing. Events sent to the main session are hit-tested by the root renderer and never enter a cross-origin iframe — and every serious job-application form is a cross-origin iframe. Mouse events have to go to the element's own session; keyboard goes to the main one. There is no coordinate translation anywhere, which was the exact opposite of what I'd built.

2. The worst bug looked identical to success.

The agent filled a Greenhouse application perfectly. Every tool call returned success. Every value landed. None of it on the tab I was watching — it had bound to a tab at startup and never re-bound. Now the panel names the tab it is driving, permanently, at the top of the window. A tool that reports success against the wrong target is worse than one that crashes.

3. I built a pairing endpoint, then deleted it.

The panel had to prove it was really my extension, so I wrote an HTTP endpoint to hand it a token. It refused its own panel: Chrome sends no Origin header at all on fetch() from an extension page. But the WebSocket upgrade does carry one, and page script cannot forge it. So identity moved onto the socket and the token left that path entirely. The best code I wrote that week is code that isn't there.

On letting a model click things: irreversible actions — submit, delete, purchase — stop and ask. That gate lives in the bridge, never in a prompt, so nothing the model says can widen its own permissions. Silence denies.

A complete job application: 10 turns, 42 seconds, $0.0959 of equivalent API spend — covered by the subscription, which was the whole point.

Open source, Apache-2.0.

github.com/Endokelp/Endoplexity

#buildinpublic #chromeextension #ai

---

## Demo recording — shot list

Needs a real screen recording; nothing here can produce one. Target ~25s, silent,
looping GIF or MP4 at the top of the README.

1. **0–3s.** Chrome on a real job posting, side panel open, panel idle. The
   provenance row already names the tab — that is the product's whole thesis in
   one frame.
2. **3–6s.** Type `Fill this application from my resume, but stop before
   submitting` and press Run.
3. **6–16s.** The trace fills in — read the page, typed into Full name, attached
   a file. Let it actually run; do not speed this up, the point is that it is
   real. Fast-forward here reads as fake.
4. **16–21s.** The approval gate appears on "Submit application". Hold on it —
   this is the frame that answers "you let an AI click submit?".
5. **21–25s.** Click Deny. Cost chip lands. End on the panel at rest.

Record at 360px panel width, dark theme, and a browser window narrow enough that
the panel is a real proportion of the frame rather than a sliver.

Before recording: reset to a clean session (the `+` in the header), and point
`.endo-files.json` at a placeholder resume — the trace names the file it reads,
and a screen recording catches it.

## Demo prompts

Ordered so each one shows a capability the previous one didn't. Every prompt
assumes the relevant page is already open and focused — a fresh Run binds to the
tab you are looking at, so open the page *first*, then press Run.

**1. Read and render** — opener, ~15s
Page: any product or pricing page.
> Summarise this page in five bullets, then put the key numbers in a table.

Shows: the accessibility snapshot, and markdown arriving as a real table instead
of literal pipes. Good first shot because it finishes fast and looks like an
answer, not a robot.

**2. Fill a form, stop at the gate** — the centrepiece, ~30s
Page: a real Greenhouse or Lever job application.
> Fill this application from my resume, but stop before submitting.

Shows: `read_file`, `type`, `select`, `upload` finding the hidden file input, and the
approval gate intercepting "Submit application". Hold on the gate. This is the
frame that answers the objection everyone has.

**3. Multi-tab comparison** — ~40s
Page: anywhere.
> Open the pricing pages for Vercel, Netlify and Cloudflare Pages in three tabs,
> then compare their free tiers in one table.

Shows: `use_tab` opening tabs, `navigate` with `full:` reading prose on arrival,
and the provenance row changing as it moves. The strongest "this is actually
agentic" shot.

**4. Navigate and come back** — ~20s
Page: any docs site.
> Find their API rate limits, then go back and tell me what the homepage claims
> about uptime.

Shows: `back` driving the real navigation history rather than guessing a URL.

**5. Lazy content** — ~20s
Page: an infinite feed (Hacker News' front page, a subreddit, a changelog).
> Scroll down and give me the first five items that mention pricing.

Shows: `scroll` as a real wheel event, so content that isn't in the DOM yet
loads. `window.scrollBy` would not do this.

**6. A dropdown that isn't a `<select>`** — ~15s
Page: the country field on a Greenhouse form.
> Set the country to Ireland.

Shows: the click-the-combobox-then-click-the-option path. Worth including
precisely because it's the case naive automation fails.

**7. Equations** — ~15s
Page: a Wikipedia maths article.
> Explain the main formula here and re-derive it step by step.

Shows: LaTeX rendered as native MathML, no library, under a CSP that forbids
every external host.

**8. The modes** — ~20s, optional closer
Run prompt 2 twice, once in **Watch me** and once in **Trust it**.

Shows: the same task asking for approval on everything, then on nothing, with
the mode chip in red the whole time `trust` is set. Ends on the honest note that
the safety is a real setting, not a slogan.

### For the recording

- End on a cost chip. `$0.0959 · 112,064 tokens · 10 turns` is the argument.
- Don't speed up the trace. It reading as real is the point; fast-forward reads
  as fake.
- Prompt 2 needs `.endo-files.json` configured, or `upload` has no key to
  resolve.

## Repo settings checklist

- [ ] Repo name `endoplexity`, description = the one-liner from `package.json`
- [ ] Topics: `chrome-extension`, `browser-automation`, `ai-agent`, `mcp`,
      `claude`, `cursor`, `cdp`
- [ ] "Releases", "Packages", "Environments" hidden in the sidebar; keep About
- [ ] Confirm no `.endo-token`, `.endo-files.json`, or `.endo-mcp.json` in the
      tree — all three are gitignored, but check the first push rather than
      trusting it
- [ ] Social preview image (GitHub → Settings → Social preview), or the link
      unfurls as a grey placeholder everywhere it is shared
