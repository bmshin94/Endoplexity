// The panel's half of the tool path. The bridge cannot touch Chrome, so every
// MCP tool call arrives here over the WebSocket and is run against cdp.js.
//
// Names and argument shapes must match bridge/src/mcp.ts — that file declares
// the schema the model sees, this one is the implementation behind it.

import * as cdp from "./cdp.js";

const TOOLS = {
  snapshot: () => cdp.snapshot(),
  navigate: ({ url }) => cdp.navigate(url),
  click: async ({ ref }) => {
    await cdp.click(ref);
    return `clicked ${ref} — the page may have changed, snapshot again before using older refs`;
  },
  type: async ({ ref, text }) => {
    await cdp.type(ref, text);
    return `typed ${text.length} characters into ${ref}`;
  },
  key: async ({ name }) => {
    await cdp.key(name);
    return `pressed ${name}`;
  },
};

export async function runTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool ${name} — have ${Object.keys(TOOLS).join(", ")}`);
  // The agent has no attach tool and should not need one: whichever tool runs
  // first takes the active tab.
  if (cdp.state().tabId === null) await cdp.attach();
  return String((await tool(args ?? {})) ?? "ok");
}
