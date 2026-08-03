import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callPanel, askPanel } from "./relay.ts";
import { check, remember } from "./gate.ts";

/**
 * The browser tools, written once. Both CLIs speak MCP, so Phase 5 gets these
 * for free — this file must never learn anything Claude-specific.
 *
 * Every handler is a relay: the bridge cannot touch Chrome, only the panel can.
 */

// Mirrors KEYS in extension/cdp.js. An enum rather than a string so a model
// guessing "Return" is corrected by the schema instead of failing at the panel.
const KEYS = ["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp"] as const;

// The denial has to read like a tool result, not a crash — the model retried
// stale refs and slider-shaped errors fine before this, so it needs the same
// kind of plain-English steer here, telling it to stop rather than route around.
const DENIED = "blocked — the human denied this action. Do not retry it; stop and report what you were about to do.";

// The one chokepoint every tool call passes through, so the gate never has to
// be wired into five separate handlers: check the policy, ask the human if it
// says so, then relay to the panel. A tool failure the model can read is worth
// more than a dead turn: "stale ref" tells it to snapshot again, which is
// exactly the recovery we want — and a denial has to read the same way.
// Exported for gate.test.ts, which drives it directly rather than standing up
// a real MCP HTTP round trip just to see the isError shape.
export async function relay(name: string, args: Record<string, unknown>) {
  const needs = check(name, args);
  if (needs && !(await askPanel(needs))) {
    return { content: [{ type: "text" as const, text: DENIED }], isError: true };
  }
  try {
    const text = await callPanel(name, args);
    remember(text);
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `error: ${(err as Error).message}` }], isError: true };
  }
}

function build() {
  const server = new McpServer({ name: "comet", version: "0.1.0" });

  server.registerTool(
    "snapshot",
    {
      description:
        "Read the current page as an indented accessibility outline. Actionable elements carry a ref like @f1e7 — pass those to click and type. Refs expire on the next snapshot or any navigation. You rarely need this: navigate, click and key already return the page they produced. Call it to re-read a page nothing has changed, or with full:true for body text.",
      inputSchema: {
        full: z
          .boolean()
          .optional()
          .describe("Include body text as well as actionable elements. Much larger — only for reading a page, not acting on it."),
      },
    },
    ({ full }) => relay("snapshot", { full }),
  );

  server.registerTool(
    "navigate",
    {
      description: "Point the tab at a URL, wait for the load, and return the loaded page. No snapshot needed afterwards.",
      inputSchema: { url: z.string().url().describe("Absolute URL including the scheme") },
    },
    ({ url }) => relay("navigate", { url }),
  );

  server.registerTool(
    "click",
    {
      description:
        "Click an element with a real mouse event and return the page as it looks afterwards, with fresh refs. Takes a ref from the most recent snapshot. Do not call snapshot after this.",
      inputSchema: { ref: z.string().describe("A ref from the latest snapshot, e.g. @f1e7") },
    },
    ({ ref }) => relay("click", { ref }),
  );

  server.registerTool(
    "type",
    {
      description:
        "Focus a field and type into it one real keystroke at a time, so autocompletes and framework handlers fire. Does not clear what is already there. Returns only an acknowledgement, so fields are cheap to fill in a row — snapshot yourself if typing revealed something new.",
      inputSchema: {
        ref: z.string().describe("A ref from the latest snapshot, e.g. @f1e7"),
        text: z.string(),
      },
    },
    (args) => relay("type", args),
  );

  server.registerTool(
    "key",
    {
      description:
        "Press a single key at whatever currently has focus, e.g. Enter to submit a search box, and return the page as it looks afterwards. Do not call snapshot after this.",
      inputSchema: { name: z.enum(KEYS) },
    },
    ({ name }) => relay("key", { name }),
  );

  return server;
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * Stateless: a fresh server and transport per request. No session map to leak,
 * and two concurrent calls cannot collide on a JSON-RPC id or share a half-open
 * stream. Cheap — registering five tools costs nothing next to a page snapshot.
 */
export async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = req.method === "POST" ? await readJson(req) : undefined;
  } catch {
    return void res.writeHead(400, { "content-type": "application/json" }).end(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }),
    );
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => void transport.close());
  await build().connect(transport);
  await transport.handleRequest(req, res, body);
}
