import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MANIFEST_PATH = fileURLToPath(new URL("../../extension/manifest.json", import.meta.url));

/**
 * Chrome derives an extension's id from its public key, not from anything in
 * the manifest's `name`/`id` fields: SHA-256 the DER-encoded key, take the
 * first 16 bytes, hex-encode, then remap each hex digit 0-9a-f onto the
 * letters a-p (Chrome's id alphabet avoids digits). Reading the key out of
 * the manifest rather than hardcoding the id means the two can never drift —
 * if they did, the failure mode is "nothing connects", the worst kind to debug.
 *
 * The key in extension/manifest.json is the public half of a one-off RSA
 * keypair (`crypto.generateKeyPairSync("rsa", { modulusLength: 2048, ... })`,
 * SPKI/DER). The private half was never written anywhere — it only signs a
 * .crx package, which this project doesn't build. Only the public key is
 * needed to pin the id.
 */
function extensionIdFromManifest(manifestPath: string): string {
  const { key } = JSON.parse(readFileSync(manifestPath, "utf8")) as { key: string };
  const der = Buffer.from(key, "base64");
  const hash = createHash("sha256").update(der).digest().subarray(0, 16);
  return [...hash.toString("hex")].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

export const ALLOWED_ORIGIN = `chrome-extension://${extensionIdFromManifest(MANIFEST_PATH)}`;

/**
 * Gate for the WebSocket upgrade: the origin must be exactly our extension.
 *
 * There is deliberately no token here any more, and the reasoning matters
 * because it reverses a previous invariant.
 *
 * The token existed to back up a WEAK origin check — `startsWith
 * ("chrome-extension://")`, which any installed extension satisfied. Now the
 * origin is one exact pinned id, so ask what the token would still add. It can
 * only add something if the panel obtains it over a channel an attacker cannot
 * use. It cannot: the panel is a browser page, so its only way to receive the
 * token is over a connection gated by... this same origin. Anyone who can forge
 * the origin can therefore collect the token first and present it. A token the
 * client can fetch for itself is theatre.
 *
 * (Measured, and the reason this changed: Chrome sends NO Origin header at all
 * on `fetch()` from an extension page when the extension holds host permissions
 * — the request is privileged rather than CORS — so an HTTP pairing endpoint
 * could not identify the caller. The WebSocket upgrade does carry a real
 * Origin, and page script cannot set one, which is what makes this check the
 * strong half all along.)
 *
 * What still holds: a website cannot open this socket, because it cannot
 * present a chrome-extension origin. A local process running as you can forge
 * one — and could always read .comet-token anyway, so nothing was lost there.
 *
 * The token is NOT gone: it is still the whole boundary on /mcp, where it is
 * genuinely load-bearing because a CLI sends no Origin to check.
 */
export function authorize(origin: string | undefined): boolean {
  return origin === ALLOWED_ORIGIN;
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
