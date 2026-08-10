# Design

## Visual Theme

An instrument clamped to the side of a browser. Dense, hairline-ruled, quiet. The vocabulary a
Raycast or Linear user already reads fluently: one sans family, tabular numerals, no
decoration that isn't state.

**Theme follows the browser, and the panel is never white.** The scene decides it: the panel is
welded to Chrome's own side-panel chrome, so a hard-committed dark column against a light
browser reads broken, not intentional. But a `#fff` panel against a `#fff` webpage stops being
a control surface and becomes more page. So both themes run on a neutral tinted toward the
accent hue, never pure black or pure white.

## Color

Strategy: **Restrained.** Tinted neutrals carry the entire surface. Three colour roles exist
and each maps to exactly one meaning. A panel with no colour on it is a panel where nothing is
happening, which is information.

| Role | Means | Light | Dark |
|---|---|---|---|
| `--accent` | live, connected, primary action, success | `oklch(0.52 0.13 152)` | `oklch(0.72 0.15 152)` |
| `--gate` | stopped, waiting on you | `oklch(0.55 0.13 75)` | `oklch(0.78 0.14 78)` |
| `--danger` | denied, failed, trust mode armed | `oklch(0.54 0.19 25)` | `oklch(0.68 0.17 25)` |

Green is the accent *and* the success colour on purpose: "the agent is acting" and "it worked"
are the same channel of news, which frees red to mean only the two things that must stop you.
Running and done are then told apart by **form** (a pulsing hairline node vs. a static tick),
never by hue alone, which is also what keeps it legible under `prefers-reduced-motion` and for
colour-blind users.

Not chosen, deliberately: Claude-amber, Perplexity-teal, Linear-violet. All three are the
category's reflex palettes.

Neutrals are tinted to hue 150 at chroma 0.004-0.014. Ground `oklch(0.982 0.004 150)` /
`oklch(0.185 0.008 150)`; raised surfaces one step up, sunken one step down; hairlines
`oklch(0.89 0.008 150)` / `oklch(0.32 0.01 150)`.

## Typography

Two families. `system-ui` stack for everything a person reads; `ui-monospace` for anything a
machine produced: refs, urls, JSON, code, and the cost chip (with `tabular-nums`).

No serif. The previous version used one for answer prose, which is the second-order reflex for
this category and read as costume.

Fixed px scale, ratio ~1.15, because the panel is a fixed-DPI fixed-width column where fluid
type only ever looks worse:

| Token | Size | Use |
|---|---|---|
| `--t-micro` | 10.5px | uppercase tracked labels, table headers |
| `--t-meta` | 11.5px | tool trace, status, cost, footnotes |
| `--t-ui` | 12.5px | controls, buttons, the user's own message |
| `--t-body` | 14px | the answer |
| `--t-lead` | 15px | h1 inside an answer |

Answer prose is capped at 68ch. The panel is narrower than that today, but Chrome's side panel
is user-resizable and the cap is what stops a widened panel from producing 140-character lines.

**Contrast over recession.** Tool-trace text is `--text-soft` (4.9:1), not a lighter grey that
would fail AA. It recedes through size, weight, and sitting behind an indent rail, which is
cheaper than contrast and does not cost accessibility.

## Layout

Fixed vertical stack, flex column, one scroll region:

```
header        identity + connection state          (fixed)
provenance    which tab is being driven + mode     (fixed, never hidden)
transcript    the conversation                     (flex: 1, the only scroller)
step          what it is doing right now           (fixed, shown only while running)
gate          approval, when asked                 (fixed, shown only when asked)
composer      textarea + controls                  (fixed)
footer        profile + raw log disclosures        (fixed)
```

Spacing scale: 2, 4, 6, 8, 12, 16, 20, 28. Radii: 6 control-inner, 9 control, 12 panel, 999
pill. Elevation is a hairline plus a 1px/4px shadow in light; hairline plus surface lift in
dark. No card ever nests inside another card.

Nothing may produce a horizontal scrollbar. Tables and `<pre>` scroll inside their own
`overflow-x: auto` box; everything else uses `overflow-wrap: anywhere`.

## Components

- **Icons**: one inline SVG sprite, 16px grid, 1.5px stroke, round cap and join, `currentColor`
  only. No emoji, no text glyphs standing in for icons. Strict CSP forbids an icon font or any
  external asset, and the sprite is `<use href="#id">` so it costs one definition each.
- **Tool trace**: consecutive calls form one unbroken hairline rail. Each is a `<details>` with
  an 11.5px one-sentence summary; args and result live inside, collapsed. The node on the rail
  is 5px: hollow while queued, accent and pulsing while running, filled tick when done, danger
  when failed.
- **Buttons**: 28px tall, 9px radius. Primary is filled accent; the rest are hairline ghosts.
  Every one has default / hover / focus-visible / active / disabled.
- **Selects**: native `<select>` with `appearance: base-select`, which hands the popup to CSS.
  Without it the dropdown is drawn by the OS: white sheet, blue highlight, no hover feedback
  and nothing to animate. With it, the picker is a themed surface (raised, hairline, 12px
  radius, shadow) that fades and lifts 6px on open, with a rotating chevron on the trigger and
  a green tick on the trailing edge of the selected row. Still a real `<select>`, so type-ahead,
  arrow keys, Home/End, Escape and the screen-reader semantics come free, and `.value` is
  unchanged. Two traps, both of which fail silently: a **descendant combinator after
  `::picker(select)` is invalid**, so `::picker(select) option {}` drops the whole rule and the
  popup renders native — style `option`, `optgroup`, `legend` with plain selectors; and
  `optgroup label="…"` is UA-drawn and unstylable, so group captions need a real `<legend>`
  child (keep the attribute for the accessible name and for pre-135 Chrome).
- **Secondary controls are ghosts**: transparent border and background until hovered, then
  `--sink`. Only the primary action is filled. Boxing every control in a hairline made the
  composer read as a toolbar of equal-weight buttons when only one of them is the action.
- **Empty state**: teaches the interface with three real tasks that load the composer rather
  than firing, because an agent that starts driving on a stray click is not a first impression.

## Motion

140ms for state, 200ms for reveal, all on `cubic-bezier(0.22, 1, 0.36, 1)`. Transform and
opacity only, never a layout property. The only looping animation in the product is the 1.6s
live-node pulse, and it conveys state. `prefers-reduced-motion: reduce` removes every
animation and transition.
