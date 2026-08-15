import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Key -> path is the whole security model for the `upload` and `read_file` tools.
 * DOM.setFileInputFiles (extension/cdp.js) runs in the BROWSER PROCESS, which
 * can read any file the user can — if the model picked the path, "fill in
 * this form" becomes `upload("C:\\Users\\me\\.ssh\\id_rsa")` then submit. So
 * the model only ever names a KEY ("resume"); this file is the one place a
 * key becomes a path, and the map is an allow-list, never anything the model says.
 *
 * There are two halves to that allow-list and they are kept in separate files:
 *
 *   .endo-files.json        the human's, hand-edited, and NEVER written by us
 *   .endo-attachments.json  the panel's paperclip, written here
 *
 * Split because they have different owners. Attaching a file in the side panel
 * has to add a key without the bridge editing a file the human maintains — one
 * bad write there loses a map they typed by hand. A collision resolves toward
 * the human's copy, and attach() will not mint a key that is already taken
 * anyway, so both stay reachable.
 *
 * A panel-attached file is COPIED here rather than referenced where it sits.
 * The browser cannot hand over a real path (an <input type="file"> gives a name
 * and bytes, nothing more), so there is no path to reference — and the copy is
 * the tighter boundary regardless: `upload` can only ever reach a directory the
 * bridge owns, instead of an arbitrary point on disk chosen by whatever last
 * wrote the config.
 *
 * Sibling of .endo-token — see index.ts's TOKEN_PATH for the same pattern.
 */
const CONFIG_PATH = fileURLToPath(new URL("../../.endo-files.json", import.meta.url));

const SHAPE = '{ "resume": "C:\\\\Users\\\\you\\\\Documents\\\\resume.pdf" }';

/**
 * A file arriving over the panel socket. Far past any resume, cover letter or
 * portfolio, and well under the ws library's 100MB frame limit once base64 has
 * added its third. docs.ts caps a READ at 50MB separately — this is the cap on
 * taking a copy at all, which is why it is the smaller of the two.
 */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

/**
 * The attachment store sits beside whichever config it belongs to, so a test
 * pointing at a temp directory gets an isolated store for free — no second path
 * argument threaded through every function, and no chance of a test reading the
 * developer's real attachments.
 */
const storeOf = (configPath: string) => ({
  json: join(dirname(configPath), ".endo-attachments.json"),
  dir: join(dirname(configPath), ".endo-attachments"),
});

// Re-read on every call instead of caching at module load: the user edits
// this file while the bridge is running (adding a key, fixing a typo'd path)
// and should not have to restart it to pick that up.
// ponytail: re-parsing a few-hundred-byte JSON file per upload call is free
// next to the page snapshot the same tool call also does.
function load(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Both halves as one map. The human's entries are spread last, so a key present
 * in both resolves to the one they typed — the deliberate copy wins over the
 * one a paperclip happened to mint.
 */
function merged(configPath: string): Record<string, string> {
  return { ...load(storeOf(configPath).json), ...load(configPath) };
}

/** The configured keys, for the tool description and error messages. */
export function keys(configPath: string = CONFIG_PATH): string[] {
  return Object.keys(merged(configPath));
}

/** A configured key -> its absolute path, or throw a clear Error. */
export function resolve(key: string, configPath: string = CONFIG_PATH): string {
  const config = merged(configPath);
  const available = Object.keys(config);
  if (available.length === 0) {
    throw new Error(
      `no files available — the user can attach one with the paperclip in the panel, or create ${configPath} shaped like ${SHAPE}`,
    );
  }
  // hasOwn, not `in` — `in` walks the prototype chain, so "constructor" and
  // "toString" would pass the one check the whole file boundary rests on.
  if (!Object.hasOwn(config, key)) {
    throw new Error(`unknown file key "${key}" — configured keys: ${available.join(", ")}`);
  }
  const path = config[key];
  // A relative path would resolve against the browser process's cwd, which
  // is not a location anyone reasoned about — reject it same as a bad key.
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error(`configured path for "${key}" is not an absolute path: ${JSON.stringify(path)}`);
  }
  // Caught here rather than left to CDP: a missing file fails opaquely deep
  // inside DOM.setFileInputFiles at the browser instead of naming itself.
  if (!existsSync(path)) {
    throw new Error(`configured path for "${key}" does not exist: ${path}`);
  }
  return path;
}

// ---------------------------------------------------------------- attaching

/**
 * A filename from the browser becomes a key made only of [a-z0-9_].
 *
 * This is a trust boundary even though a human picked the file: the name rides
 * in over the socket as a string, and it is about to be part of a path this
 * process writes to. Building the on-disk name out of the SLUG rather than out
 * of the original means "../../.ssh/authorized_keys" cannot describe a location
 * — every character that could steer a path is gone before a path exists.
 */
function slug(name: string): string {
  const file = basename(name);
  // Drop the suffix only when safeExt agrees it IS one. extname() is happy to
  // call ".2 final" an extension, so "v1.2 final" keyed as "v1" — the half of
  // the name that identified the file thrown away by a rule about extensions.
  const stem = file
    .slice(0, file.length - safeExt(file).length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  // "…", ".gitignore" and "____" all land here. A key still has to be something
  // the model can say back.
  return stem || "file";
}

/**
 * The extension, kept only when it is plainly an extension.
 *
 * Not cosmetic: docs.ts dispatches on it, so a .docx that loses its suffix is
 * read as raw zip bytes and refused. Bounded to letters and digits for the same
 * reason as slug() — this ends up in a filename.
 */
function safeExt(name: string): string {
  const ext = extname(basename(name)).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/** `resume`, then `resume_2` — never silently replacing a key already in use. */
function uniqueKey(name: string, taken: Record<string, string>): string {
  const base = slug(name);
  if (!Object.hasOwn(taken, base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!Object.hasOwn(taken, candidate)) return candidate;
  }
}

/** One file the agent can reach, as the panel draws it. */
export type Listed = { key: string; name: string; size: number; fixed: boolean };

/**
 * Every key the agent can reach right now, for the panel's chips.
 *
 * `fixed` marks the hand-configured ones: they show without a remove button,
 * because the panel must not delete a file it did not put there. A key whose
 * file has since gone is dropped rather than listed — a chip for something
 * `resolve()` would refuse is worse than no chip.
 */
export function list(configPath: string = CONFIG_PATH): Listed[] {
  const own = load(configPath);
  return Object.entries(merged(configPath)).flatMap(([key, path]) => {
    if (typeof path !== "string") return [];
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return [];
    }
    return [{ key, name: basename(path), size, fixed: Object.hasOwn(own, key) }];
  });
}

/**
 * Copy a file the human picked in the panel into the bridge's own directory and
 * give it a key. Returns what the panel needs to draw a chip.
 */
export function attach(name: unknown, bytes: Buffer, configPath: string = CONFIG_PATH): Listed {
  if (typeof name !== "string" || !name.trim()) throw new Error("a file needs a name");
  // Empty covers the honest empty file and a `data` field that was not base64:
  // Buffer.from(x, "base64") drops anything outside the alphabet instead of
  // throwing, so garbage decodes to a short buffer rather than an error.
  if (bytes.length === 0) throw new Error(`${basename(name)} is empty (or did not arrive intact)`);
  if (bytes.length > MAX_ATTACH_BYTES) {
    throw new Error(
      `${basename(name)} is ${Math.round(bytes.length / 1024 / 1024)}MB — the limit is ${MAX_ATTACH_BYTES / 1024 / 1024}MB`,
    );
  }

  const store = storeOf(configPath);
  const key = uniqueKey(name, merged(configPath));
  const path = join(store.dir, key + safeExt(name));

  mkdirSync(store.dir, { recursive: true });
  writeFileSync(path, bytes);

  const map = load(store.json);
  map[key] = path;
  writeFileSync(store.json, JSON.stringify(map, null, 2));

  return { key, name: basename(path), size: bytes.length, fixed: false };
}

/**
 * Forget an attachment and delete the copy.
 *
 * Only ever touches the attachment store: a key from .endo-files.json is the
 * human's, and the panel removing it would silently edit a file they maintain
 * by hand. Unknown keys are a no-op — a chip clicked twice is not an error.
 */
export function detach(key: unknown, configPath: string = CONFIG_PATH): void {
  if (typeof key !== "string") return;
  const store = storeOf(configPath);
  const map = load(store.json);
  if (!Object.hasOwn(map, key)) return;
  const path = map[key];
  delete map[key];
  writeFileSync(store.json, JSON.stringify(map, null, 2));
  // The map is the source of truth, so it is updated first: a file that will
  // not delete (locked by a reader on Windows) must not leave a live key
  // pointing at something the panel says is gone.
  rmSync(path, { force: true });
}
