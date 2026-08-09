// The panel's half of the tool path. The bridge cannot touch Chrome, so every
// MCP tool call arrives here over the WebSocket and is run against cdp.js.
//
// Names and argument shapes must match bridge/src/mcp.ts — that file declares
// the schema the model sees, this one is the implementation behind it.

import * as cdp from "./cdp.js";

// Anything that moves the page hands back the page, because a separate snapshot
// call is a whole model turn and a turn re-sends the entire conversation. `type`
// is the exception on purpose: filling a six-field form must not cost six
// snapshots, and the page rarely changes between fields. If it does — an
// autocomplete list, a field that reveals another — the model can still ask.
//
// The two tools that ARRIVE somewhere also take `full`, so a reading task gets
// the prose with the page instead of paying a second turn to re-read it. Acting
// tools deliberately do not: they run mid-form, where body text is dead weight
// that every later turn re-sends.
const TOOLS = {
  snapshot: ({ full, from }) => cdp.snapshot({ full, from }),
  navigate: async ({ url, full }) => {
    await cdp.navigate(url);
    return cdp.snapshot({ full });
  },
  click: ({ ref }) => cdp.click(ref),
  type: async ({ ref, text }) => {
    await cdp.type(ref, text);
    return `typed ${text.length} characters into ${ref}`;
  },
  key: ({ name }) => cdp.key(name),
  upload: ({ path, match }) => cdp.upload(path, match),
  select: ({ ref, value }) => cdp.select(ref, value),
  scroll: ({ direction, ref }) => cdp.scroll(direction, ref),
  hover: ({ ref }) => cdp.hover(ref),
  back: () => cdp.go("back"),
  forward: () => cdp.go("forward"),
  // The one tool here that returns no page: a tab list is orientation, and
  // paying for a snapshot of a tab the agent may not even switch to is the
  // opposite of what "actions return the page" is for.
  tabs: () => cdp.tabs(),
  use_tab: ({ id, url, full }) => cdp.useTab(id, url, { full }),
};

export async function runTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool ${name} — have ${Object.keys(TOOLS).join(", ")}`);
  // The agent has no attach tool and should not need one: whichever tool runs
  // first takes the active tab.
  if (cdp.state().tabId === null) await cdp.attach();
  try {
    return String((await tool(args ?? {})) ?? "ok");
  } catch (err) {
    // A stale/unknown ref used to cost a whole model turn to recover from:
    // click -> stale -> snapshot -> click. Handing back the fresh page with
    // the error means the model can act correctly on its NEXT turn instead
    // of spending one just re-snapshotting.
    if (!/stale ref|unknown ref/.test(err.message)) throw err;
    let page;
    try {
      page = await cdp.snapshot();
    } catch {
      throw err; // recovery itself failed — surface the real problem, not this one
    }
    throw new Error(`${err.message}\n\nthe page as it is now:\n${page}`);
  }
}
