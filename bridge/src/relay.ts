import type { WebSocket } from "ws";

/**
 * The bridge's half of the tool path: an MCP tool call arrives over HTTP, has to
 * run in the panel (which owns chrome.debugger), and the answer has to find its
 * way back to the HTTP request that is still open.
 *
 * One panel at a time. A second connection replaces the first rather than
 * queueing, because two panels driving one tab is not a state worth supporting.
 *
 * Also owns the approval-gate transport (askPanel/settleGate): gate.ts decides
 * whether a call needs a human, this file is just the socket round trip to ask
 * one, with its own id sequence and pending map so a slow gate reply can never
 * be mistaken for a tool result.
 */

type Pending = { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };
type GatePending = { resolve: (approved: boolean) => void; timer: NodeJS.Timeout };

// A snapshot of a heavy page is the slow one; everything else is milliseconds.
const TIMEOUT_MS = 30_000;
// Long enough for a human to actually look, short enough that a task doesn't
// hang forever on a panel nobody is watching — silence denies rather than blocks.
const GATE_TIMEOUT_MS = 60_000;

let panel: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let gateSeq = 0;
const gatePending = new Map<number, GatePending>();

function failAll(why: string) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(why));
  }
  pending.clear();
  // A pending approval belongs to the same dead connection — deny it rather
  // than leave the model's tool call hanging until the gate's own 60s timer.
  for (const { resolve, timer } of gatePending.values()) {
    clearTimeout(timer);
    resolve(false);
  }
  gatePending.clear();
}

export function setPanel(ws: WebSocket) {
  // Anything in flight belonged to the old socket and can never be answered now.
  if (panel && panel !== ws) failAll("the panel reconnected mid-call");
  panel = ws;
}

/** Close handler. Ignores a stale socket whose replacement is already serving. */
export function dropPanel(ws: WebSocket) {
  if (panel !== ws) return;
  panel = null;
  failAll("the panel disconnected");
}

export const panelConnected = () => panel?.readyState === 1;

/** Resolve the call the panel is answering. Unknown ids are late timeouts. */
export function settle(msg: { id?: number; ok?: boolean; value?: string; error?: string }) {
  const hit = typeof msg.id === "number" && pending.get(msg.id);
  if (!hit) return;
  pending.delete(msg.id!);
  clearTimeout(hit.timer);
  if (msg.ok) hit.resolve(msg.value ?? "");
  else hit.reject(new Error(msg.error ?? "the panel gave no reason"));
}

/** Run a tool in the panel and wait for its answer. */
export function callPanel(name: string, args: Record<string, unknown>): Promise<string> {
  if (!panelConnected()) {
    return Promise.reject(new Error("no side panel connected — open it and check it says connected"));
  }
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${name} timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    panel!.send(JSON.stringify({ type: "tool", id, name, args }));
  });
}

/**
 * Ask the panel to approve an irreversible action and wait for the human.
 * Denies immediately with no panel connected, and denies on a 60s timeout —
 * silence is not consent, and a stuck task is worse than an over-cautious one.
 */
export function askPanel(action: string): Promise<boolean> {
  if (!panelConnected()) return Promise.resolve(false);
  const id = ++gateSeq;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      gatePending.delete(id);
      resolve(false);
    }, GATE_TIMEOUT_MS);
    gatePending.set(id, { resolve, timer });
    panel!.send(JSON.stringify({ type: "gate", id, action }));
  });
}

/** Resolve the approval the panel is answering. Unknown ids are late replies. */
export function settleGate(msg: { id?: number; approved?: boolean }) {
  const hit = typeof msg.id === "number" && gatePending.get(msg.id);
  if (!hit) return;
  gatePending.delete(msg.id!);
  clearTimeout(hit.timer);
  hit.resolve(msg.approved === true);
}
