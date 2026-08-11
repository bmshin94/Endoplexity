import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Key -> path is the whole security model for the `upload` tool.
 * DOM.setFileInputFiles (extension/cdp.js) runs in the BROWSER PROCESS, which
 * can read any file the user can — if the model picked the path, "fill in
 * this form" becomes `upload("C:\\Users\\me\\.ssh\\id_rsa")` then submit. So
 * the model only ever names a KEY ("resume"); this file is the one place a
 * key becomes a path, and the map is a fixed allow-list the human edits on
 * disk, never anything the model says.
 *
 * Sibling of .endo-token — see index.ts's TOKEN_PATH for the same pattern.
 */
const CONFIG_PATH = fileURLToPath(new URL("../../.endo-files.json", import.meta.url));

const SHAPE = '{ "resume": "C:\\\\Users\\\\you\\\\Documents\\\\resume.pdf" }';

// Re-read on every call instead of caching at module load: the user edits
// this file while the bridge is running (adding a key, fixing a typo'd path)
// and should not have to restart it to pick that up.
// ponytail: re-parsing a few-hundred-byte JSON file per upload call is free
// next to the page snapshot the same tool call also does.
function load(configPath: string): Record<string, string> {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** The configured keys, for the tool description and error messages. */
export function keys(configPath: string = CONFIG_PATH): string[] {
  return Object.keys(load(configPath));
}

/** A configured key -> its absolute path, or throw a clear Error. */
export function resolve(key: string, configPath: string = CONFIG_PATH): string {
  const config = load(configPath);
  const available = Object.keys(config);
  if (available.length === 0) {
    throw new Error(`no files configured — create ${configPath} shaped like ${SHAPE}`);
  }
  if (!(key in config)) {
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
