import type { WebSocket } from "ws";

/**
 * The bridge's half of the tool path: an MCP tool call arrives over HTTP, has to
 * run in the panel (which owns chrome.debugger), and the answer has to find its
 * way back to the HTTP request that is still open.
 *
 * One panel at a time. A second connection replaces the first rather than
 * queueing, because two panels driving one tab is not a state worth supporting.
 */

type Pending = { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

// A snapshot of a heavy page is the slow one; everything else is milliseconds.
const TIMEOUT_MS = 30_000;

let panel: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(why: string) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(why));
  }
  pending.clear();
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
