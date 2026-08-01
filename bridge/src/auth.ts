import { timingSafeEqual } from "node:crypto";

/**
 * Gate for the WebSocket upgrade.
 *
 * Two independent checks, both required:
 *  - Origin must be a chrome extension. Browsers set Origin themselves and a
 *    page cannot override it, so this alone stops any website you visit from
 *    opening a socket to the bridge and driving your logged-in tabs.
 *  - Token must match the one written to .comet-token, which stops other local
 *    processes (and other extensions) that can forge an Origin header.
 */
export function authorize(
  origin: string | undefined,
  presented: string | null,
  expected: string,
): boolean {
  if (!origin?.startsWith("chrome-extension://")) return false;
  return sameToken(presented, expected);
}

export function sameToken(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare length separately.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Gate for the MCP endpoint, where the Origin rule is the exact inverse of the
 * WebSocket's: the only legitimate caller is a CLI we spawned ourselves, and a
 * CLI never sends Origin. A browser always does on a cross-origin request and
 * cannot suppress it, so any request carrying one is a web page trying to drive
 * the tab — refused before the token is even considered.
 */
export function authorizeMcp(origin: string | undefined, presented: string | null, expected: string): boolean {
  if (origin) return false;
  return sameToken(presented, expected);
}
