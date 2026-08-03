import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import { authorize, authorizeMcp } from "./auth.ts";
import { handleMcp } from "./mcp.ts";
import { setPanel, dropPanel, settle, settleGate } from "./relay.ts";
import { runClaude, writeMcpConfig } from "./claude.ts";

const HOST = "127.0.0.1"; // never 0.0.0.0 — this socket can drive a logged-in browser
// Overridable only so a second instance can be smoke-tested without evicting the
// one your panel is talking to. The extension always dials 8787.
const PORT = Number(process.env.COMET_PORT ?? 8787);
const TOKEN_PATH = fileURLToPath(new URL("../../.comet-token", import.meta.url));

function loadToken(): string {
  if (existsSync(TOKEN_PATH)) return readFileSync(TOKEN_PATH, "utf8").trim();
  const token = randomBytes(24).toString("hex");
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

// Hand-run target for the CDP layer: host.html iframes form.html from the OTHER
// loopback hostname, which Chrome treats as a different site and puts in its own
// renderer. That is the Greenhouse/Lever/Workday shape, reproducible offline.
// An explicit map, not a path join — no traversal to get wrong.
const FIXTURES: Record<string, URL> = {
  "/fixtures/host.html": new URL("../test/fixtures/host.html", import.meta.url),
  "/fixtures/form.html": new URL("../test/fixtures/form.html", import.meta.url),
};

const token = loadToken();
const configPath = writeMcpConfig(PORT, token);
const wss = new WebSocketServer({ noServer: true });

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);

  if (url.pathname === "/mcp") {
    if (!authorizeMcp(req.headers.origin, url.searchParams.get("token"), token)) {
      console.warn(`refused /mcp from origin=${req.headers.origin ?? "(none)"}`);
      return void res.writeHead(401).end();
    }
    return void (await handleMcp(req, res));
  }

  const fixture = FIXTURES[url.pathname];
  if (!fixture) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(fixture));
});

http.on("upgrade", (req, socket, head) => {
  const presented = new URL(req.url ?? "/", `http://${HOST}`).searchParams.get("token");
  if (!authorize(req.headers.origin, presented, token)) {
    console.warn(`refused upgrade from origin=${req.headers.origin ?? "(none)"}`);
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

// One task at a time. Two agents driving one tab would fight over every ref.
let running: ChildProcess | null = null;

// Twice now the agent has written its tool calls out as XML text instead of
// calling anything: one turn, zero real calls, then a confident report of a
// browser session that never happened. Both times the init event listed the
// tools, and the fake calls invented parameter names the real schemas do not
// have — so ToolSearch never returned and this is model-side, not config.
// Nothing in a prompt has fixed it; one respawn costs ~$0.05 and has recovered
// every time. The run is swallowed rather than shown: a hallucinated browser
// session in the log is worse than no log at all.
const FAKE_XML = /<function_calls>|<invoke name=/;

const usedTools = (event: Record<string, unknown>) =>
  event.type === "assistant" &&
  ((event.message as { content?: { type?: string }[] } | undefined)?.content ?? []).some(
    (part) => part.type === "tool_use",
  );

function startTask(ws: WebSocket, prompt: unknown, isRetry = false) {
  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "task-event", event }));
  };
  if (typeof prompt !== "string" || !prompt.trim()) return send({ type: "failed", error: "empty prompt" });
  if (running) return send({ type: "failed", error: "a task is already running — stop it first" });

  console.log(`task: ${prompt}`);
  let sawTool = false;
  let redo = false;
  running = runClaude(prompt, (event) => {
    if (usedTools(event)) sawTool = true;
    // Only worth retrying a run that did nothing: once a real tool call has
    // landed, the same text pattern is the agent quoting itself, not faking.
    if (event.type === "result" && !sawTool && !isRetry && FAKE_XML.test(JSON.stringify(event))) redo = true;
    if (event.type === "done" || event.type === "failed") running = null;
    // Untruncated, because this is the one line that settles "did the agent
    // actually have the tools" — a model that emits fake <function_calls> XML as
    // text looks identical in the panel to one whose tools are missing.
    if (event.type === "system" && event.subtype === "init") {
      console.log(`  tools: ${JSON.stringify(event.tools)}`);
    }
    console.log(`  ${JSON.stringify(event).slice(0, 200)}`);

    if (!redo) return send(event);
    // Swallow the void run entirely, then respawn once the child is actually
    // gone. The panel stays busy throughout, so this reads as one slow task.
    if (event.type === "done" || event.type === "failed") {
      send({ type: "retry", reason: "the agent wrote its tool calls as text instead of calling them — retrying once" });
      startTask(ws, prompt, true);
    }
  });
}

wss.on("connection", (ws) => {
  console.log("panel connected");
  setPanel(ws);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ponytail: malformed frames are dropped, no error channel needed until there is a protocol
    }
    if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
    else if (msg.type === "tool-result") settle(msg);
    else if (msg.type === "gate-reply") settleGate(msg);
    else if (msg.type === "task") startTask(ws, msg.prompt);
    else if (msg.type === "stop") running?.kill();
  });

  ws.on("close", () => {
    dropPanel(ws);
    console.log("panel disconnected");
  });
});

http.listen(PORT, HOST, () => {
  console.log(`bridge listening on ws://${HOST}:${PORT}`);
  console.log(`token: ${token}`);
  console.log("paste that into the side panel once; it is stored in chrome.storage.local");
  console.log(`mcp config for the CLIs: ${configPath}`);
});
