import * as cdp from "./cdp.js";
import { measure, selftest } from "./selftest.js";
import { runTool } from "./tools.js";

const BRIDGE = "ws://127.0.0.1:8787";

// Tasks have buttons now. The console stays exposed because it is still the only
// way to reach the CDP layer directly (`comet.snapshot()`, `await comet.selftest()`)
// — right-click the panel -> Inspect. `comet.task` drives the same path the Run
// button does, so the buttons never disagree with what is actually running.
globalThis.comet = {
  ...cdp,
  selftest,
  measure,
  task: (prompt) => {
    promptEl.value = prompt;
    runTask();
  },
  stop: () => stopBtn.click(),
};

const dot = document.getElementById("dot");
const status = document.getElementById("status");
const setup = document.getElementById("setup");
const tokenInput = document.getElementById("token");
const logEl = document.getElementById("log");
const promptEl = document.getElementById("prompt");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");

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

/** Returns false if there was nowhere to send it, so callers can bail. */
function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    log("not connected");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
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

// The phase gate is a number, so the number has to be on screen. Every input
// class counts: cache reads are cheaper per token but they are still context the
// model re-reads on every turn, which is exactly what this phase is cutting.
function cost(event) {
  const u = event.usage ?? {};
  const tokens =
    (u.input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.output_tokens ?? 0);
  return `— $${(event.total_cost_usd ?? 0).toFixed(4)} · ${tokens.toLocaleString()} tokens · ${event.num_turns ?? "?"} turns · ${Math.round((event.duration_ms ?? 0) / 1000)}s`;
}

// ponytail: still the readable slice of claude's stream-json, not a renderer.
// Phase 3 was meant to add a step list; the log already renders each tool call
// the moment it happens, which is what a step list would have shown. Build the
// cards when there is something to put on them — status, timing, a retry.
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
  if (event.type === "result") return `${event.result ?? event.subtype}\n${cost(event)}`;
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
      // "done" is the child exiting, however it went — including a Stop.
      if (msg.event.type === "done" || msg.event.type === "failed") setBusy(false);
      const line = describe(msg.event);
      return void (line && log(line));
    }
    log(`< ${event.data}`);
  };

  // A rejected upgrade closes without ever firing onopen, which is what a bad
  // token looks like from here — the browser hides the 401 from page script.
  ws.onclose = () => {
    if (ws !== socket) return; // superseded by a newer connect()
    setBusy(false); // the task, if any, went with the socket
    setState("down", opened ? "disconnected" : "refused");
    if (opened) {
      log("disconnected");
    } else {
      log("refused — is the bridge running, and is the token right?");
      setup.classList.add("show");
    }
  };
}

// The bridge runs one task at a time, so the buttons say which one is possible.
function setBusy(on) {
  runBtn.disabled = on;
  stopBtn.disabled = !on;
}

function runTask() {
  // The console path shares this, so the guard has to live here rather than on
  // the button — otherwise comet.task() twice gets a "already running" failure
  // back and that clears the busy state out from under the task still going.
  if (runBtn.disabled) return log("a task is already running — stop it first");

  const prompt = promptEl.value.trim() || promptEl.placeholder;
  if (!send({ type: "task", prompt })) return; // still idle, Run stays live
  log(`▶ ${prompt}`);
  setBusy(true);
}

runBtn.addEventListener("click", runTask);
stopBtn.addEventListener("click", () => {
  log("■ stopping");
  send({ type: "stop" });
});

// Enter runs, shift+Enter is a newline — the prompt is usually one line.
promptEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || runBtn.disabled) return;
  event.preventDefault();
  runTask();
});

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

log("type a task and hit Run — `await comet.selftest()` in this panel's console checks the tools");

const { token } = await chrome.storage.local.get("token");
if (token) {
  connect(token);
} else {
  setState("down", "needs token");
  setup.classList.add("show");
  log("no token stored yet");
}
