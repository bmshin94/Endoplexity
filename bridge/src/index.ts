import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { authorize } from "./auth.ts";

const HOST = "127.0.0.1"; // never 0.0.0.0 — this socket can drive a logged-in browser
const PORT = 8787;
const TOKEN_PATH = fileURLToPath(new URL("../../.comet-token", import.meta.url));

function loadToken(): string {
  if (existsSync(TOKEN_PATH)) return readFileSync(TOKEN_PATH, "utf8").trim();
  const token = randomBytes(24).toString("hex");
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

const token = loadToken();
const wss = new WebSocketServer({ noServer: true });
const http = createServer((_req, res) => {
  res.writeHead(404).end();
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

wss.on("connection", (ws) => {
  console.log("panel connected");
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ponytail: malformed frames are dropped, no error channel needed until there is a protocol
    }
    if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
  });
  ws.on("close", () => console.log("panel disconnected"));
});

http.listen(PORT, HOST, () => {
  console.log(`bridge listening on ws://${HOST}:${PORT}`);
  console.log(`token: ${token}`);
  console.log("paste that into the side panel once; it is stored in chrome.storage.local");
});
