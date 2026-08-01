import * as cdp from "./cdp.js";
import { selftest } from "./selftest.js";

const BRIDGE = "ws://127.0.0.1:8787";

// Phase 1 has no model and no panel UI for the tools yet (that is Phase 3), so
// the hand-run surface is this page's own devtools console: right-click the
// panel -> Inspect, then `await comet.selftest()`.
globalThis.comet = { ...cdp, selftest };

const dot = document.getElementById("dot");
const status = document.getElementById("status");
const setup = document.getElementById("setup");
const tokenInput = document.getElementById("token");
const logEl = document.getElementById("log");

let socket = null;
let sentAt = 0;

function log(line) {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setState(state, text) {
  dot.className = state;
  status.textContent = text;
}

function connect(token) {
  socket?.close();
  setState("", "connecting…");

  const ws = new WebSocket(`${BRIDGE}?token=${encodeURIComponent(token)}`);
  socket = ws;
  let opened = false;

  ws.onopen = () => {
    opened = true;
    setState("up", "connected");
    setup.classList.remove("show");
    log("connected to bridge");
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "pong") log(`pong — round trip ${Date.now() - sentAt}ms`);
    else log(`< ${event.data}`);
  };

  // A rejected upgrade closes without ever firing onopen, which is what a bad
  // token looks like from here — the browser hides the 401 from page script.
  ws.onclose = () => {
    if (ws !== socket) return; // superseded by a newer connect()
    setState("down", opened ? "disconnected" : "refused");
    if (opened) {
      log("disconnected");
    } else {
      log("refused — is the bridge running, and is the token right?");
      setup.classList.add("show");
    }
  };
}

document.getElementById("save").addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  await chrome.storage.local.set({ token });
  connect(token);
});

document.getElementById("ping").addEventListener("click", () => {
  if (socket?.readyState !== WebSocket.OPEN) return log("not connected");
  sentAt = Date.now();
  socket.send(JSON.stringify({ type: "ping" }));
  log("ping >");
});

log("tools on `comet` — selftest, attach, snapshot, click, type, key, state, detach");

const { token } = await chrome.storage.local.get("token");
if (token) {
  connect(token);
} else {
  setState("down", "needs token");
  setup.classList.add("show");
  log("no token stored yet");
}
