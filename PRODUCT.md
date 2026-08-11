# Product

## Register

product

## Users

One person, at their own laptop, in a lit room, already mid-task on a real website. The panel
is a ~360px column clamped to the right of the browser they are actively using. They are not
reading it the way they read a chat app; they glance at it sideways while watching their own
page get clicked, typed into, and navigated by something else.

The job to be done: *"do this thing on the page I am looking at, and let me see that you did
it on the right page."* Everything else is secondary to that sentence.

## Product Purpose

Endoplexity replicates Perplexity Comet's browser control, driven by existing Claude Max and
Cursor subscriptions instead of metered API keys. The extension never talks to a model, the
CLI never talks to Chrome; the panel is the only surface either one has.

Success is that the panel disappears into the task. The user should end a run knowing three
things without effort: which tab was driven, what the agent did there, and what it cost.

## Brand Personality

Precise, quiet, accountable. It is an instrument, not an assistant persona. It never performs
enthusiasm, never celebrates, and never narrates what it is about to do. It reports.

## Anti-references

- **Chat-app cosplay.** Two-column bubbles, avatars, typing dots, "Thinking…" theatre.
- **The tool-call firehose.** Raw JSON and step logs given the same weight as the answer. This
  is the specific failure the user named: *"too much attention is drawn on the tool usage."*
- **Claude-orange, Perplexity-teal, Linear-violet.** The three reflex palettes for this exact
  category. Also the warm-cream-plus-serif "editorial" answer, which is the second-order
  reflex and is what the previous version shipped.
- **Anything that reads as more webpage.** The panel sits against arbitrary sites; if it
  borrows their surface it stops being a control surface.

## Design Principles

1. **The answer is the content. Everything else is chrome.** Tool calls, costs, and status are
   evidence, and evidence is available, not loud.
2. **Show which tab, always.** The worst failure this project has had was a form filled
   perfectly in a tab nobody was watching. Provenance is a permanent, first-class element.
3. **Colour means state, never decoration.** Three roles only: live/primary, needs-you,
   danger. A surface with no colour on it is a surface where nothing is happening.
4. **Render what the model meant.** Tables, emphasis, code and equations arrive as markdown and
   must leave as tables, emphasis, code and equations, never as literal syntax.
5. **Nothing may scroll sideways.** The browser owns the horizontal axis at 360px.

## Accessibility & Inclusion

WCAG 2.2 AA on text and non-text contrast. `prefers-reduced-motion` removes all animation
including the live-state pulse (state must remain legible without it, so running/done/failed
differ in form, not only hue). `prefers-color-scheme` is honoured in both directions. Every
control is keyboard-reachable with a visible focus ring; state is never signalled by colour
alone.
