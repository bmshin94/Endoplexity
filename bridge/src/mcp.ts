import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callPanel, askPanel } from "./relay.ts";
import { check, remember, rememberApproval, resetApprovals, labelFor, type Mode } from "./gate.ts";
import { keys, resolve } from "./files.ts";
import { extract, page } from "./docs.ts";

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

// A document arrives in one piece up to here, then pages with `from:` — see
// page() in docs.ts for why it is capped at all. ~8k characters is roughly 2k
// tokens and lets an ordinary CV or letter land whole, so the common case
// never costs a second call.
const READ_CAP = 8000;

// Shared by the two tools that ARRIVE somewhere. Reading a page is a different
// job from acting on one, and it is the job the arriving tool can do for free:
// without this a research task spends a whole extra model turn per source
// re-reading the page it was just handed — and every turn re-sends the ones
// before it. Deliberately not on click/key/back/forward: those are acting, and
// a schema field is paid on every turn by every run.
const full = z
  .boolean()
  .optional()
  .describe("Include the page's body text, for reading it rather than acting on it. Much larger — leave it off unless you need the prose.");

// The one chokepoint every tool call passes through, so the gate never has to
// be wired into five separate handlers: check the policy, ask the human if it
// says so, then relay to the panel. A tool failure the model can read is worth
// more than a dead turn: "stale ref" tells it to snapshot again, which is
// exactly the recovery we want — and a denial has to read the same way.
// Exported for gate.test.ts, which drives it directly rather than standing up
// a real MCP HTTP round trip just to see the isError shape.
const MODES = new Set<Mode>(["watch", "normal", "trust"]);
let mode: Mode | undefined;

/**
 * The human's autonomy choice for the run about to start. Anything that is not
 * one of the three known modes becomes undefined, which gate.ts treats as
 * `normal` — so a garbled message fails closed, never open.
 *
 * Clearing the approval memory here rather than from a second call in index.ts
 * is deliberate: a mode is only ever set at the start of a task, and the memory
 * is per-task, so they share one lifecycle and cannot be left out of step.
 */
export function setMode(next: unknown): void {
  mode = MODES.has(next as Mode) ? (next as Mode) : undefined;
  resetApprovals();
}

export async function relay(name: string, args: Record<string, unknown>) {
  const needs = check(name, args, mode);
  if (needs) {
    if (!(await askPanel(needs))) {
      return { content: [{ type: "text" as const, text: DENIED }], isError: true };
    }
    // Watch mode asks about a whole class of action, so approving one has to
    // stand for the rest of the task or it asks on every keystroke and nobody
    // uses it twice. gate.ts ignores this in `normal`, where each irreversible
    // action is meant to be answered on its own.
    rememberApproval(name, args);
  }
  try {
    // The label is what turns "clicked @f0e38" into "clicked Submit
    // application" in the panel. gate.ts already keeps the ref->label map for
    // its own policy, so this costs a lookup rather than a round trip.
    const text = await callPanel(name, args, typeof args.ref === "string" ? labelFor(args.ref) : undefined);
    remember(text);
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const text = `error: ${(err as Error).message}`;
    // A failed action's error message can carry the FRESH page (stale-ref
    // recovery) — if that page never reaches remember(), the gate's
    // ref->label map goes stale on exactly the page the model is about to
    // act on next, and it silently stops recognising a submit button. Do
    // not "clean up" this call: remember() is already a no-op on text with
    // no ref lines, so it costs nothing on an ordinary error.
    remember(text);
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}

function build() {
  const server = new McpServer({ name: "endo", version: "0.1.0" });

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
        from: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start reading at this line, to see past a page that said it had more lines below. Refs do not change between pages of the same read."),
      },
    },
    (args) => relay("snapshot", args),
  );

  server.registerTool(
    "navigate",
    {
      description: "Point the tab at a URL, wait for the load, and return the loaded page. No snapshot needed afterwards.",
      inputSchema: { url: z.string().url().describe("Absolute URL including the scheme"), full },
    },
    (args) => relay("navigate", args),
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

  // The available keys are read fresh on every build() (every request, see
  // handleMcp below) — same lazy-read reasoning as files.ts itself, so a key
  // added while the bridge is running shows up in the description right away.
  const fileKeys = keys();
  // The no-files line names a recovery the human can perform in the window they
  // are already looking at, same rule as the snapshot cap notice: "add it to
  // .endo-files.json" sent people to a text editor for what is now a paperclip.
  const keysNote = fileKeys.length
    ? `Available keys: ${fileKeys.join(", ")}.`
    : "No files are available — tell the user to attach one with the paperclip in the panel's composer.";

  server.registerTool(
    "upload",
    {
      description:
        `Put one of the user's files into a file input on the page and return the page afterwards — do not call snapshot after this. Takes a KEY, never a path: only files the human attached or configured can be sent. ${keysNote} No ref needed: the real input is often hidden behind a styled button.`,
      inputSchema: {
        file: z.string().describe('A configured key, e.g. "resume" — not a file path'),
        match: z
          .string()
          .optional()
          .describe("Only needed when the page has more than one file input, which the result says — part of the wanted input's label, e.g. \"cover\""),
      },
    },
    async ({ file, match }) => {
      try {
        return await relay("upload", { path: resolve(file), match });
      } catch (err) {
        // Same rule as relay()'s own catch above: a tool failure the model
        // can read is worth more than a dead turn. resolve() throws
        // synchronously on a bad/missing key, before relay() ever runs — this
        // catch is what turns that into an isError result instead of an MCP
        // protocol error the model cannot see or recover from.
        return { content: [{ type: "text" as const, text: `error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      description:
        `Read a configured document as text — pdf, docx, xlsx, pptx, csv, json, markdown or any text file. ` +
        `Takes a KEY, never a path, exactly like upload. ${keysNote} ` +
        `This is how you learn what is IN a file; upload attaches one to a form without ever reading it.`,
      inputSchema: {
        file: z.string().describe('A configured key, e.g. "resume" — not a file path'),
        from: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start reading at this character, to continue past a document that said it had more."),
      },
    },
    async ({ file, from }) => {
      try {
        // Deliberately not through relay(): this never touches Chrome, so
        // there is no page to return and nothing for the gate to weigh —
        // reading a file the human put in the allow-list themselves is not an
        // irreversible act. resolve() is the whole security boundary, and it
        // is the same one upload goes through.
        const text = page(await extract(resolve(file)), from, READ_CAP, file);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "select",
    {
      description:
        "Choose an option in a NATIVE <select> and return the page afterwards — do not call snapshot after this. click cannot operate a native select: its popup is browser UI the renderer never sees. Most job forms instead use a custom combobox, which this refuses with an error telling you to click it open and click the option; that path works, so try this first and follow the error if it comes.",
      inputSchema: {
        ref: z.string().describe("A ref from the latest snapshot, e.g. @f1e7"),
        value: z.string().describe("The option's visible text or its value attribute"),
      },
    },
    (args) => relay("select", args),
  );

  server.registerTool(
    "scroll",
    {
      description:
        "Scroll the page a screenful and return it afterwards. You do NOT need this to reach something already in the snapshot — click scrolls to its target itself. Use it for content that has not loaded yet (infinite feeds, lazy lists), or pass a ref inside an open dropdown to scroll that dropdown instead of the page behind it.",
      inputSchema: {
        direction: z.enum(["down", "up"]).optional().describe("Default down"),
        ref: z
          .string()
          .optional()
          .describe("Scroll the scrollable area containing this ref, e.g. an open dropdown list, instead of the whole page"),
      },
    },
    (args) => relay("scroll", args),
  );

  server.registerTool(
    "hover",
    {
      description:
        "Move the mouse onto an element and return the page afterwards — for menus that open on hover, whose items are absent from the page until then.",
      inputSchema: { ref: z.string().describe("A ref from the latest snapshot, e.g. @f1e7") },
    },
    ({ ref }) => relay("hover", { ref }),
  );

  server.registerTool(
    "back",
    {
      description: "Go back one page in this tab's history and return the page that lands. Use it to undo a wrong click.",
      inputSchema: {},
    },
    () => relay("back", {}),
  );

  server.registerTool(
    "forward",
    { description: "Go forward one page in this tab's history and return the page that lands.", inputSchema: {} },
    () => relay("forward", {}),
  );

  server.registerTool(
    "tabs",
    {
      description:
        "List the open tabs with their ids; the one you are driving is starred. The only tool that does not return a page. Call it when a click seems to have done nothing — a link that opens a new tab leaves you on the old one.",
      inputSchema: {},
    },
    () => relay("tabs", {}),
  );

  server.registerTool(
    "use_tab",
    {
      description:
        "Switch to another tab, or open a new one, and return the page there. Every ref you are holding belongs to the tab you are leaving and stops working — read the page you get back.",
      inputSchema: {
        id: z.number().int().optional().describe("An id from tabs()"),
        url: z.string().url().optional().describe("Open a new tab here instead. Use navigate to move the tab you are already on."),
        full,
      },
    },
    (args) => relay("use_tab", args),
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
