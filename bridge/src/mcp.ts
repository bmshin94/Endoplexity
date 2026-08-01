import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callPanel } from "./relay.ts";

/**
 * The browser tools, written once. Both CLIs speak MCP, so Phase 5 gets these
 * for free — this file must never learn anything Claude-specific.
 *
 * Every handler is a relay: the bridge cannot touch Chrome, only the panel can.
 */

// Mirrors KEYS in extension/cdp.js. An enum rather than a string so a model
// guessing "Return" is corrected by the schema instead of failing at the panel.
const KEYS = ["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp"] as const;

// A tool failure the model can read is worth more than a dead turn: "stale ref"
// tells it to snapshot again, which is exactly the recovery we want.
const relay = (name: string, args: Record<string, unknown>) =>
  callPanel(name, args).then(
    (text) => ({ content: [{ type: "text" as const, text }] }),
    (err: Error) => ({ content: [{ type: "text" as const, text: `error: ${err.message}` }], isError: true }),
  );

function build() {
  const server = new McpServer({ name: "comet", version: "0.1.0" });

  server.registerTool(
    "snapshot",
    {
      description:
        "Read the current page as an indented accessibility outline. Actionable elements carry a ref like @f1e7 — pass those to click and type. Refs expire on the next snapshot or any navigation, so call this again after the page changes.",
      inputSchema: {},
    },
    () => relay("snapshot", {}),
  );

  server.registerTool(
    "navigate",
    {
      description: "Point the tab at a URL and wait for it to finish loading. Call snapshot afterwards to see it.",
      inputSchema: { url: z.string().url().describe("Absolute URL including the scheme") },
    },
    ({ url }) => relay("navigate", { url }),
  );

  server.registerTool(
    "click",
    {
      description: "Click an element with a real mouse event. Takes a ref from the most recent snapshot.",
      inputSchema: { ref: z.string().describe("A ref from the latest snapshot, e.g. @f1e7") },
    },
    ({ ref }) => relay("click", { ref }),
  );

  server.registerTool(
    "type",
    {
      description:
        "Focus a field and type into it one real keystroke at a time, so autocompletes and framework handlers fire. Does not clear what is already there.",
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
      description: "Press a single key at whatever currently has focus, e.g. Enter to submit a search box.",
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
