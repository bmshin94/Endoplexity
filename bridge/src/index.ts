import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import { authorize, authorizeMcp } from "./auth.ts";
import { handleMcp } from "./mcp.ts";
import { setPanel, dropPanel, settle } from "./relay.ts";
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

function startTask(ws: WebSocket, prompt: unknown) {
  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "task-event", event }));
  };
  if (typeof prompt !== "string" || !prompt.trim()) return send({ type: "failed", error: "empty prompt" });
  if (running) return send({ type: "failed", error: "a task is already running — stop it first" });

  console.log(`task: ${prompt}`);
  running = runClaude(prompt, (event) => {
    if (event.type === "done" || event.type === "failed") running = null;
    console.log(`  ${JSON.stringify(event).slice(0, 200)}`);
    send(event);
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
