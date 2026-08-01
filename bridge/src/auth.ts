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
  if (!presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare length separately.
  return a.length === b.length && timingSafeEqual(a, b);
}
