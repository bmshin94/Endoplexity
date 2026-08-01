import * as cdp from "./cdp.js";
import { selftest } from "./selftest.js";
import { runTool } from "./tools.js";

const BRIDGE = "ws://127.0.0.1:8787";

// Phase 2 has no panel UI for tasks yet (that is Phase 3), so the hand-run
// surface is this page's own devtools console: right-click the panel ->
// Inspect, then `comet.task("...")` or `await comet.selftest()`.
globalThis.comet = {
  ...cdp,
  selftest,
  task: (prompt) => send({ type: "task", prompt }),
  stop: () => send({ type: "stop" }),
};

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

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return log("not connected");
  socket.send(JSON.stringify(payload));
}

/** Run a tool the bridge asked for and answer it, however it went. */
async function answer({ id, name, args }) {
  try {
    send({ type: "tool-result", id, ok: true, value: await runTool(name, args) });
  } catch (err) {
    // Errors go back as results, not thrown away: "stale ref" is the model's cue
    // to snapshot again, and it can only act on what it is told.
    log(`${name} failed — ${err.message}`);
    send({ type: "tool-result", id, ok: false, error: err.message });
  }
}

// ponytail: the readable slice of claude's stream-json, not a renderer. Phase 3
// builds the real step list; until then anything else is noise in a log pane.
function describe(event) {
  if (event.type === "assistant") {
    return (event.message?.content ?? [])
      .map((part) =>
        part.type === "tool_use"
          ? `→ ${part.name.replace("mcp__comet__", "")} ${JSON.stringify(part.input)}`
          : part.text,
      )
      .filter(Boolean)
      .join("\n");
  }
  if (event.type === "result") return event.result ?? `result: ${event.subtype}`;
  if (event.type === "done") return event.error ? `failed — ${event.error}` : "task finished";
  if (event.type === "failed") return `failed — ${event.error}`;
  return null;
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
    if (msg.type === "pong") return log(`pong — round trip ${Date.now() - sentAt}ms`);
    if (msg.type === "tool") return void answer(msg);
    if (msg.type === "task-event") {
      const line = describe(msg.event);
      return void (line && log(line));
    }
    log(`< ${event.data}`);
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
  sentAt = Date.now();
  send({ type: "ping" });
  log("ping >");
});

log("`comet.task(\"...\")` to run one, `comet.stop()` to kill it, `comet.selftest()` to check the tools");

const { token } = await chrome.storage.local.get("token");
if (token) {
  connect(token);
} else {
  setState("down", "needs token");
  setup.classList.add("show");
  log("no token stored yet");
}
