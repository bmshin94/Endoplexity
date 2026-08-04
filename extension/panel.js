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
const profileEl = document.getElementById("profile");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const modelEl = document.getElementById("model");
const gate = document.getElementById("gate");
const gateAction = document.getElementById("gate-action");
const gateApprove = document.getElementById("gate-approve");
const gateDeny = document.getElementById("gate-deny");

let socket = null;
let sentAt = 0;
// The bridge holds one task at a time, so at most one gate is ever open. Tracking
// its id (not just a boolean) lets a stale button click be told apart from a
// still-live one if a row somehow outlives its gate.
let pendingGateId = null;

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

function showGate({ id, action }) {
  pendingGateId = id;
  gateAction.textContent = action;
  gate.classList.add("show");
}

function hideGate() {
  pendingGateId = null;
  gate.classList.remove("show");
}

/** Approve/Deny share this — only the boolean differs. */
function replyGate(approved) {
  // A click can still land after the row is hidden (double-click, or the task
  // ended first) — with no pending id there is nothing left to resolve.
  if (pendingGateId === null) return;
  const action = gateAction.textContent;
  send({ type: "gate-reply", id: pendingGateId, approved });
  hideGate();
  log(`${approved ? "approved" : "denied"} — ${action}`);
}

gateApprove.addEventListener("click", () => replyGate(true));
gateDeny.addEventListener("click", () => replyGate(false));

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
// Only the fields that are actually present get a slot: cursor's result carries
// neither a price nor a token count, and a printed "$0.0000 · 0 tokens" would read
// as a free run rather than an unreported one.
function cost(event) {
  // claude reports snake_case, cursor camelCase. Reading only one spelling is how
  // a run that cost 60k tokens prints as 0 — the number this phase gate is
  // measured on, silently absent.
  const u = event.usage ?? {};
  const tokens =
    (u.input_tokens ?? u.inputTokens ?? 0) +
    (u.cache_creation_input_tokens ?? u.cacheWriteTokens ?? 0) +
    (u.cache_read_input_tokens ?? u.cacheReadTokens ?? 0) +
    (u.output_tokens ?? u.outputTokens ?? 0);
  const parts = [];
  if (event.total_cost_usd !== undefined) parts.push(`$${event.total_cost_usd.toFixed(4)}`);
  if (tokens) parts.push(`${tokens.toLocaleString()} tokens`);
  if (event.num_turns !== undefined) parts.push(`${event.num_turns} turns`);
  parts.push(`${Math.round((event.duration_ms ?? 0) / 1000)}s`);
  return `— ${parts.join(" · ")}`;
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
  // cursor's own tool-call event. Only the start is logged — the completion
  // repeats the args and carries the whole tool result, which is a page.
  if (event.type === "tool_call") {
    if (event.subtype !== "started") return null;
    // Keyed by tool kind — `mcpToolCall`, `shellToolCall` — and an MCP call nests
    // the name and args one level further in, as `comet-navigate`.
    const call = event.tool_call ?? {};
    const kind = Object.keys(call)[0] ?? "tool";
    const args = call[kind]?.args ?? {};
    const name = args.name ?? kind;
    return `→ ${String(name).replace(/^comet-/, "")} ${JSON.stringify(args.args ?? args.command ?? args)}`;
  }
  // The bridge terminal already prints this, but a fake-<function_calls> run is
  // diagnosed from the panel log — so the evidence has to be in the same paste.
  // cursor's init has no tool list, so it reports what it does carry instead.
  if (event.type === "system" && event.subtype === "init") {
    return event.tools
      ? `tools: ${event.tools.join(", ") || "(none)"}`
      : `model: ${event.model ?? "?"} · auth: ${event.apiKeySource ?? "?"}`;
  }
  if (event.type === "retry") return `↻ ${event.reason}`;
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
    if (msg.type === "gate") {
      showGate(msg);
      return log(`? approval requested — ${msg.action}`);
    }
    if (msg.type === "task-event") {
      // "done" is the child exiting, however it went — including a Stop.
      if (msg.event.type === "done" || msg.event.type === "failed") {
        setBusy(false);
        // The bridge only denies-and-moves-on after its own 60s timeout, but the
        // task can also end on its own first (Stop, crash) — either way the row
        // must not sit there looking answerable once nothing is listening.
        if (pendingGateId !== null) {
          hideGate();
          log("gate unanswered — bridge denied it when the task ended");
        }
      }
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
  const profile = profileEl.value.trim();
  // The bridge gets `sent` (prompt + profile); the log below stays on `prompt`
  // alone. Profile is personal data — name, email, phone — and the log is what
  // gets pasted into bug reports and phase write-ups. Do not "simplify" this to
  // log `sent` — that would leak it into every paste.
  const sent = profile ? `${prompt}\n\nApplicant details:\n${profile}` : prompt;
  const model = modelEl.value;
  if (!send({ type: "task", prompt: sent, model })) return; // still idle, Run stays live
  log(`▶ [${model}] ${prompt}`);
  setBusy(true);
}

// Survives the panel closing, which Chrome does on every window switch.
modelEl.addEventListener("change", () => chrome.storage.local.set({ model: modelEl.value }));
profileEl.addEventListener("change", () => chrome.storage.local.set({ profile: profileEl.value }));

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

const { token, model, profile } = await chrome.storage.local.get(["token", "model", "profile"]);
if (model) modelEl.value = model;
if (profile) profileEl.value = profile;
if (token) {
  connect(token);
} else {
  setState("down", "needs token");
  setup.classList.add("show");
  log("no token stored yet");
}
