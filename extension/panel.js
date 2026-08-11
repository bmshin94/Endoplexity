import * as cdp from "./cdp.js";
import { measure, selftest } from "./selftest.js";
import { runTool } from "./tools.js";
import * as ui from "./transcript.js";
import { fresh, pack, startNew, titleOf } from "./sessions.js";

// No token anywhere in here on purpose. The bridge identifies this panel by the
// Origin Chrome puts on the upgrade, which page script cannot forge — see the
// reasoning on authorize() in bridge/src/auth.ts.
const BRIDGE = "ws://127.0.0.1:8787";

// Tasks have buttons. The console stays exposed because it is still the only
// way to reach the CDP layer directly (`endo.snapshot()`, `await
// endo.selftest()`) — right-click the panel -> Inspect. `endo.task` drives the
// same path the Run button does, so the buttons never disagree with what is
// actually running.
globalThis.endo = {
  ...cdp,
  selftest,
  measure,
  task: (prompt) => {
    promptEl.value = prompt;
    runTask();
  },
  reply: (answer) => {
    promptEl.value = answer;
    runTask(true);
  },
  stop: () => stopBtn.click(),
  // A bug report is now one call and a copy, instead of selecting a <pre>.
  log: () => logEl.textContent,
};

const dot = document.getElementById("dot");
const status = document.getElementById("status");
const whereState = document.getElementById("where-state");
const whereTitle = document.getElementById("where-title");
const whereMode = document.getElementById("where-mode");
const logEl = document.getElementById("log");
const chatEl = document.getElementById("chat");
const stepEl = document.getElementById("step");
const promptEl = document.getElementById("prompt");
const profileEl = document.getElementById("profile");
const runBtn = document.getElementById("run");
const replyBtn = document.getElementById("reply");
const stopBtn = document.getElementById("stop");
const modelEl = document.getElementById("model");
const modeEl = document.getElementById("mode");
const gate = document.getElementById("gate");
const gateAction = document.getElementById("gate-action");
const gateApprove = document.getElementById("gate-approve");
const gateDeny = document.getElementById("gate-deny");
const newBtn = document.getElementById("new");
const historyEl = document.getElementById("history");
const historyOpen = document.getElementById("history-open");
const viewingBar = document.getElementById("viewing");
const toCurrentBtn = document.getElementById("to-current");

ui.mount(chatEl, stepEl, logEl, () => save());

let socket = null;
// The bridge holds one task at a time, so at most one gate is ever open.
// Tracking its id (not just a boolean) lets a stale button click be told apart
// from a still-live one if a row somehow outlives its gate.
let pendingGateId = null;
// Whether the last run left a transcript the bridge can continue. The id itself
// stays bridge-side. Set from the bridge's `hello` on every connect, because a
// panel remount used to reset this to false and Reply went dark after a window
// switch even though the bridge still held the session.
let resumable = false;

/**
 * Sessions, newest first, with sessions[0] the live one. Mirrored into
 * chrome.storage.local so a transcript outlives both the panel document (Chrome
 * tears it down on every window switch) and the bridge.
 *
 * `viewing` is an index into it. Anything other than 0 is history: read-only,
 * Reply off, and never written back — sessions[0] is the only slot that grows.
 */
let sessions = [fresh()];
let viewing = 0;
let saveTimer = null;

/** Copy the live journal into the live slot. Cheap; the pack() caps it. */
function syncLive() {
  sessions[0].entries = pack(ui.snapshot());
}

/**
 * Debounced, because a running task journals a line every few hundred ms and
 * chrome.storage.local is a real write each time.
 */
function save() {
  // A history view replays into the journal, so saving from one would copy an
  // old transcript over the live slot.
  if (viewing !== 0) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    syncLive();
    chrome.storage.local.set({ sessions });
    drawHistory();
  }, 400);
}

const when = (at) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function drawHistory() {
  historyEl.replaceChildren();
  if (sessions.length === 1 && !sessions[0].entries.length) {
    const hint = document.createElement("div");
    hint.className = "hempty";
    hint.textContent = "nothing yet — finished sessions are kept here";
    return void historyEl.appendChild(hint);
  }
  sessions.forEach((session, index) => {
    const row = document.createElement("button");
    row.className = index === viewing ? "hrow on" : "hrow";
    const title = document.createElement("span");
    title.className = "htitle";
    title.textContent = titleOf(session);
    const stamp = document.createElement("span");
    stamp.className = "hwhen";
    stamp.textContent = index === 0 ? "current" : when(session.at);
    row.append(title, stamp);
    row.addEventListener("click", () => showSession(index));
    historyEl.appendChild(row);
  });
}

/**
 * Put a session on screen. Restoring a COPY of the entries matters: the journal
 * is appended to by anything that renders, and a history view that shared the
 * stored array would quietly grow an old session every time it printed a note.
 */
function showSession(index) {
  if (index !== 0 && runBtn.disabled) {
    return ui.note("a task is running — stop it or wait before opening an earlier session");
  }
  if (viewing === 0) syncLive(); // don't lose what has not been debounced yet
  viewing = index;
  ui.restore((sessions[index]?.entries ?? []).slice());
  viewingBar.classList.toggle("show", index !== 0);
  setBusy(false);
  drawHistory();
  historyOpen.open = false;
}

/**
 * Tell the bridge to forget its CLI session, or a Reply after the next remount
 * would resume the conversation New just archived.
 *
 * Latched rather than fire-and-forget: with the socket down there is nothing to
 * tell, but the bridge still holds the id, and its `hello` on reconnect would
 * light Reply straight back up on the fresh session. Deliberately not routed
 * through send(), whose "not connected" note would land in the empty transcript
 * this is part of creating.
 */
let dropPending = false;

function dropBridgeSession() {
  dropPending = true;
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "new-session" }));
  dropPending = false;
}

/** Start clean without losing what came before — the live one moves to History. */
function newSession() {
  syncLive();
  sessions = startNew(sessions);
  viewing = 0;
  viewingBar.classList.remove("show");
  ui.clear();
  dropBridgeSession();
  resumable = false;
  setBusy(false);
  chrome.storage.local.set({ sessions });
  drawHistory();
  promptEl.focus();
}

function setState(state, text) {
  dot.className = state;
  status.textContent = text;
}

/**
 * Which tab is being driven, and how it is going.
 *
 * This exists because of the worst failure this project has had: attach() bound
 * once and nothing re-bound it, so a panel left open kept driving whatever tab
 * was active when it first attached. A Greenhouse form was filled perfectly,
 * every tool returning success, in a tab nobody was watching. Re-attaching on a
 * fresh Run fixed the cause; showing the tab is what makes it visible when it
 * happens again for some other reason.
 */
const STATE_ICON = { idle: "#i-dot", run: "#i-live", done: "#i-check", fail: "#i-x" };

function setWhere(page, state) {
  if (page !== undefined) {
    whereTitle.textContent = page ? page.title || page.url : "no tab attached yet";
    whereTitle.title = page ? page.url : "";
    whereTitle.classList.toggle("idle", !page);
  }
  if (state !== undefined) {
    whereState.firstElementChild.setAttribute("href", STATE_ICON[state] ?? STATE_ICON.idle);
    // setAttribute, not .className: on an SVGElement className is a read-only
    // SVGAnimatedString, so assigning to it silently does nothing.
    whereState.setAttribute("class", state === "idle" ? "icon" : `icon ${state}`);
  }
}

function showMode() {
  whereMode.textContent = modeEl.selectedOptions[0].textContent;
  // Trust turns off the only safety feature there is, so it must never be
  // quietly in force — it stays on screen, coloured, the whole time it is set.
  whereMode.className = modeEl.value === "normal" ? "" : modeEl.value;
}

/** Returns false if there was nowhere to send it, so callers can bail. */
function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    ui.note("not connected");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function showGate({ id, action }) {
  pendingGateId = id;
  gateAction.textContent = action;
  gate.classList.add("show");
  ui.gateRow(action);
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
  send({ type: "gate-reply", id: pendingGateId, approved });
  hideGate();
  ui.gateSettled(approved);
}

gateApprove.addEventListener("click", () => replyGate(true));
gateDeny.addEventListener("click", () => replyGate(false));

// Tools that land somewhere new, so the header has to be re-read afterwards.
const MOVES = new Set(["navigate", "use_tab", "back", "forward"]);

/** Run a tool the bridge asked for and answer it, however it went. */
async function answer({ id, name, args, label }) {
  // The row goes up before the call runs: this is the "watch it work" line, and
  // a step that only appears once it has finished is not one.
  const row = ui.tool(name, args, label);
  try {
    const value = await runTool(name, args);
    row.ok(value);
    if (MOVES.has(name)) setWhere(await cdp.currentPage().catch(() => null));
    send({ type: "tool-result", id, ok: true, value });
  } catch (err) {
    // Errors go back as results, not thrown away: "stale ref" is the model's cue
    // to snapshot again, and it can only act on what it is told.
    row.fail(err.message);
    send({ type: "tool-result", id, ok: false, error: err.message });
  }
}

// The phase gate is a number, so the number has to be on screen. Only the fields
// actually present get a slot: cursor's result carries neither a price nor a
// token count, and a printed "$0.0000 · 0 tokens" would read as a free run
// rather than an unreported one.
function cost(event) {
  // claude reports snake_case, cursor camelCase. Reading only one spelling is
  // how a run that cost 60k tokens prints as 0.
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
  return parts.join(" · ");
}

// Both CLIs emit the final message twice — once as an assistant event, once as
// the result's summary — which printed every answer twice over.
let lastSaid = "";

/**
 * One task event -> the conversation.
 *
 * Tool calls are deliberately NOT read out of the model's events any more. The
 * bridge already tells the panel every call it must run, with its name and
 * args, so answer() renders them — which means claude's nested `tool_use` parts
 * and cursor's separate `tool_call` events both stop needing special cases, and
 * a gate-denied call correctly shows an approval row and no tool row.
 */
function show(event) {
  if (event.type === "assistant") {
    const said = (event.message?.content ?? [])
      .filter((part) => part.type !== "tool_use")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (!said) return;
    lastSaid = said;
    return ui.assistant(said);
  }
  // cursor's tool_call event is now redundant with answer()'s row.
  if (event.type === "tool_call") return;
  // The bridge terminal prints this too, but a fake-<function_calls> run is
  // diagnosed from the panel — so the evidence has to be in the same paste.
  // cursor's init has no tool list, so it reports what it does carry instead.
  if (event.type === "system" && event.subtype === "init") {
    return ui.note(
      event.tools
        ? `tools: ${event.tools.join(", ") || "(none)"}`
        : `model: ${event.model ?? "?"} · auth: ${event.apiKeySource ?? "?"}`,
    );
  }
  if (event.type === "retry") return ui.note(`↻ ${event.reason}`);
  if (event.type === "result") {
    const said = String(event.result ?? "").trim();
    // Usually a verbatim repeat of the assistant event, but not always: cursor
    // can finish with result:"" after leaving its answer in thinking deltas
    // (measured on composer-2.5), so dropping it unconditionally would lose the
    // only copy on some runs.
    if (said && said !== lastSaid) ui.assistant(said);
    else if (!said && !lastSaid) {
      ui.note("the model produced no text — cursor sometimes leaves its answer in thinking deltas");
    }
    return ui.chip(cost(event));
  }
  if (event.type === "done" && event.error) return ui.note(`failed — ${event.error}`);
  if (event.type === "failed") return ui.note(`failed — ${event.error}`);
}

// ---- connection -------------------------------------------------------------

let retryTimer = null;
let backoff = 1000;
let beat = null;
let missedPong = false;

function stopBeat() {
  if (beat) clearInterval(beat);
  beat = null;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 15_000);
}

function connect() {
  socket?.close();
  setState("", "connecting…");

  const ws = new WebSocket(BRIDGE);
  socket = ws;
  let opened = false;

  ws.onopen = () => {
    opened = true;
    backoff = 1000;
    setState("up", "connected");
    // A half-open socket after laptop sleep never fires onclose — the tab just
    // stops receiving. A ping nobody answers is the only way to notice, so an
    // unanswered one closes the socket and lets the retry ladder take over.
    missedPong = false;
    stopBeat();
    beat = setInterval(() => {
      if (missedPong) return ws.close();
      missedPong = true;
      ws.send(JSON.stringify({ type: "ping" }));
    }, 20_000);
  };

  ws.onmessage = (event) => {
    // Everything, including messages the conversation drops — this is the log
    // that settles "did the agent actually have the tools".
    ui.raw(`< ${event.data}`);
    const msg = JSON.parse(event.data);
    if (msg.type === "pong") return void (missedPong = false);
    if (msg.type === "tool") return void answer(msg);
    if (msg.type === "hello") {
      // A New pressed while the socket was down is only now reaching the bridge,
      // so this hello describes the session it is about to drop — don't believe
      // its `resumable`.
      const dropping = dropPending;
      if (dropping) dropBridgeSession();
      // What the panel cannot know after a remount.
      resumable = dropping ? false : msg.resumable === true;
      // Its events are about to start arriving, and they belong to the live
      // transcript — not to whatever archived one is on screen.
      if (msg.running && viewing !== 0) showSession(0);
      setBusy(msg.running === true);
      if (msg.running) ui.note("reconnected — the task that was running is still running");
      return;
    }
    if (msg.type === "gate") return void showGate(msg);
    if (msg.type === "task-event") {
      // "done" is the child exiting, however it went — including a Stop.
      if (msg.event.type === "done" || msg.event.type === "failed") {
        // The bridge annotates the terminal event rather than sending one of
        // its own, so Reply lights up in the same tick Run does.
        resumable = msg.event.resumable === true;
        setBusy(false);
        setWhere(undefined, msg.event.error ? "fail" : "done");
        // The bridge only denies-and-moves-on after its own 60s timeout, but the
        // task can also end first (Stop, crash) — either way the row must not
        // sit there looking answerable once nothing is listening.
        if (pendingGateId !== null) {
          hideGate();
          ui.note("gate unanswered — the bridge denied it when the task ended");
        }
      }
      return void show(msg.event);
    }
  };

  // A rejected upgrade closes without ever firing onopen, which is what both a
  // stopped bridge and a refused origin look like from here — the browser hides
  // the status line from page script, so the two are told apart by reading
  // .endo-bridge.log, which prints the origin it refused.
  ws.onclose = () => {
    if (ws !== socket) return; // superseded by a newer connect()
    stopBeat();
    setBusy(false);
    setState("down", opened ? "reconnecting…" : "bridge not running");
    if (!opened && backoff === 1000) {
      ui.note("no bridge on 127.0.0.1:8787 — it starts at login, or double-click Endoplexity.vbs. If it IS running, .endo-bridge.log says which origin it refused.");
    }
    scheduleRetry();
  };
}

// The bridge runs one task at a time, so the buttons say which one is possible.
function setBusy(on) {
  runBtn.disabled = on;
  // Never from a history view: the bridge holds one transcript, and it is the
  // live one — replying from an archived session would answer a different
  // conversation than the one on screen.
  replyBtn.disabled = on || !resumable || viewing !== 0;
  stopBtn.disabled = !on;
  // A new session while a task runs would leave the running task journalling
  // into it. Stop first.
  newBtn.disabled = on;
  if (!on) ui.step(null);
}

/** Run is a fresh conversation; Reply continues the last one. */
async function runTask(resume = false) {
  // The console path shares this, so the guard lives here rather than on the
  // button — otherwise endo.task() twice gets an "already running" failure back
  // and that clears the busy state out from under the task still going.
  if (resume ? replyBtn.disabled : runBtn.disabled) {
    // Reply is disabled for three different reasons — say which one applies.
    return ui.note(
      resume && viewing !== 0
        ? "you are reading an earlier session — go back to the current one to reply"
        : resume && !resumable
          ? "nothing to reply to yet"
          : "a task is already running — stop it first",
    );
  }

  // Run always drives the live session, so it takes you back to it first —
  // otherwise the new task's events would render into an archived transcript.
  if (viewing !== 0) showSession(0);

  const typed = promptEl.value.trim();
  // The placeholder is an example task, so falling back to it on a reply would
  // send the agent an answer it never asked for.
  if (resume && !typed) return ui.note("type your answer first");
  const prompt = typed || promptEl.placeholder;

  // Claim the slot before the await below, or a second Run lands in the window
  // where the guard has passed but nothing is disabled yet.
  setBusy(true);
  lastSaid = "";

  // A fresh Run drives the tab you are looking at NOW.
  //
  // attach() binds once and nothing ever re-bound it, so a panel left open kept
  // driving whatever tab happened to be active the first time it attached.
  // Measured 2026-08-09: attached to an about:blank tab, the user opened a
  // Greenhouse posting in a different tab and asked to apply, and the agent
  // navigated ITS tab there and filled the form — every call succeeded, every
  // value landed, none of it on the page being watched.
  //
  // Only on a fresh Run: there is no transcript and no refs yet, so re-binding
  // costs nothing. A reply must not — mid-conversation the agent is holding
  // refs, and they belong to the tab it has been looking at all along.
  if (!resume) {
    try {
      await cdp.detach();
      await cdp.attach();
    } catch (err) {
      // Not fatal: runTool attaches lazily on the first call, so the task can
      // still run — it just loses the page context below.
      ui.note(`could not attach to the active tab — ${err.message}`);
    }
  }

  // "Apply to THIS job" is unanswerable unless the task says which page this is.
  // Without it the agent asked for a URL instead of acting — it has no way to
  // know a tab is even open. Skipped on a reply: it is already in the
  // transcript, and the agent has been looking at that page ever since.
  const page = resume ? null : await cdp.currentPage().catch(() => null);
  // On a reply the profile is already in the transcript being resumed, and
  // re-appending it would re-send the same personal data every turn.
  const profile = resume ? "" : profileEl.value.trim();
  // The bridge gets `sent`; the transcript below shows `prompt` alone. Profile
  // is personal data — name, email, phone — and the log is what gets pasted
  // into bug reports. Do not "simplify" this to show `sent`.
  const sent = [
    page && `The page you are on is "${page.title}" — ${page.url}`,
    prompt,
    profile && `Applicant details:\n${profile}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  // The model rides along, but the bridge overrules it on a reply: a claude
  // transcript cannot be handed to cursor-agent.
  if (!send({ type: "task", prompt: sent, model: modelEl.value, mode: modeEl.value, resume })) {
    return setBusy(false);
  }
  ui.user(prompt);
  setWhere(resume ? undefined : page, "run");
  // Only on a reply — a re-read task is worth keeping in the box, a re-sent
  // answer is just the same answer twice.
  if (resume) promptEl.value = "";
}

// Survives the panel closing, which Chrome does on every window switch.
modelEl.addEventListener("change", () => chrome.storage.local.set({ model: modelEl.value }));
profileEl.addEventListener("change", () => chrome.storage.local.set({ profile: profileEl.value }));
modeEl.addEventListener("change", () => {
  chrome.storage.local.set({ mode: modeEl.value });
  showMode();
});

// The empty state's examples load the box rather than firing straight off — the
// point is to show what a task looks like, and an agent that starts driving the
// browser on a stray click is not a good first impression.
for (const seed of document.querySelectorAll(".seed")) {
  seed.addEventListener("click", () => {
    promptEl.value = seed.textContent.trim();
    promptEl.focus();
  });
}

newBtn.addEventListener("click", () => newSession());
toCurrentBtn.addEventListener("click", () => showSession(0));

// Wrapped, not passed directly — a listener is handed the MouseEvent, which as
// runTask's first argument would make every click a reply.
runBtn.addEventListener("click", () => runTask());
replyBtn.addEventListener("click", () => runTask(true));
stopBtn.addEventListener("click", () => {
  ui.note("stopping");
  send({ type: "stop" });
});

// Enter starts a fresh task; ctrl/cmd+Enter answers the agent; shift+Enter is a
// newline. Reply used to win the key outright whenever it was live, reasoning
// that the reflex after a question is to type and hit Enter. Measured
// 2026-08-09: Reply stays live forever after any finished task, so the far
// commoner reflex — type the NEXT task, hit Enter — silently resumed the
// previous conversation instead. It voided two cost measurements. The asymmetry
// decides it: a fresh Run is at worst more expensive, a wrong Reply is wrong.
promptEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  const resume = event.ctrlKey || event.metaKey;
  // Only guarded for a fresh run — a ctrl+Enter with nothing to reply to falls
  // through to runTask, which says so rather than swallowing the keystroke.
  if (!resume && runBtn.disabled) return;
  event.preventDefault();
  runTask(resume);
});

const stored = await chrome.storage.local.get(["model", "profile", "mode", "sessions"]);
if (stored.model) modelEl.value = stored.model;
if (stored.profile) profileEl.value = stored.profile;
if (stored.mode) modeEl.value = stored.mode;
showMode();

// Before the first note, so the greeting does not land on top of a transcript
// that is being restored. Chrome tears this document down on every window
// switch, so "restore what was here" is the common path, not the rare one.
if (Array.isArray(stored.sessions) && stored.sessions.length) sessions = stored.sessions;
if (sessions[0].entries.length) ui.restore(sessions[0].entries.slice());
else ui.note("type a task and hit Run — `await endo.selftest()` in this panel's console checks the tools");
drawHistory();

connect();
