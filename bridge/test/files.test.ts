import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keys, resolve } from "../src/files.ts";

// keys()/resolve() take the config path as their last argument precisely so
// tests can point at a throwaway file instead of the real .comet-files.json —
// same seam cursor.ts's writeCursorConfig(dir) already uses.
const dir = () => mkdtempSync(join(tmpdir(), "comet-files-test-"));
const configAt = (d: string, content: unknown) => {
  const path = join(d, ".comet-files.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
};

function throwsWithMessage(fn: () => unknown, ...substrings: string[]) {
  assert.throws(fn, (err: unknown) => {
    const msg = (err as Error).message;
    for (const s of substrings) {
      assert.ok(msg.includes(s), `expected message to include ${JSON.stringify(s)}, got: ${msg}`);
    }
    return true;
  });
}

test("resolves a configured key to its absolute path", () => {
  const d = dir();
  const target = join(d, "resume.pdf");
  writeFileSync(target, "pdf bytes");
  const config = configAt(d, { resume: target });

  assert.deepEqual(keys(config), ["resume"]);
  assert.equal(resolve("resume", config), target);
  rmSync(d, { recursive: true, force: true });
});

test("an unknown key lists the keys that ARE configured", () => {
  const d = dir();
  const target = join(d, "resume.pdf");
  writeFileSync(target, "pdf bytes");
  const config = configAt(d, { resume: target });

  throwsWithMessage(() => resolve("coverLetter", config), 'unknown file key "coverLetter"', "resume");
  rmSync(d, { recursive: true, force: true });
});

test("a missing config file has no keys, and resolve names the expected path and shape", () => {
  const d = dir();
  const config = join(d, ".comet-files.json"); // never written

  assert.deepEqual(keys(config), []);
  throwsWithMessage(() => resolve("resume", config), "no files configured", config, "resume");
  rmSync(d, { recursive: true, force: true });
});

test("malformed JSON is treated the same as no config", () => {
  const d = dir();
  const config = configAt(d, "{ not json");

  assert.deepEqual(keys(config), []);
  throwsWithMessage(() => resolve("resume", config), "no files configured");
  rmSync(d, { recursive: true, force: true });
});

test("an empty object is treated the same as no config", () => {
  const d = dir();
  const config = configAt(d, {});

  assert.deepEqual(keys(config), []);
  throwsWithMessage(() => resolve("resume", config), "no files configured");
  rmSync(d, { recursive: true, force: true });
});

test("a relative path is rejected even though the key exists", () => {
  const d = dir();
  const config = configAt(d, { resume: "resume.pdf" });

  throwsWithMessage(() => resolve("resume", config), "not an absolute path", "resume.pdf");
  rmSync(d, { recursive: true, force: true });
});

test("a configured-but-nonexistent file names the key and the path", () => {
  const d = dir();
  const missing = join(d, "ghost.pdf");
  const config = configAt(d, { resume: missing });

  throwsWithMessage(() => resolve("resume", config), "resume", missing);
  rmSync(d, { recursive: true, force: true });
});
