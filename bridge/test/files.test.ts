import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_ATTACH_BYTES, attach, detach, keys, list, resolve } from "../src/files.ts";

// keys()/resolve() take the config path as their last argument precisely so
// tests can point at a throwaway file instead of the real .endo-files.json —
// same seam cursor.ts's writeCursorConfig(dir) already uses.
const dir = () => mkdtempSync(join(tmpdir(), "endo-files-test-"));
const configAt = (d: string, content: unknown) => {
  const path = join(d, ".endo-files.json");
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
  const config = join(d, ".endo-files.json"); // never written

  assert.deepEqual(keys(config), []);
  throwsWithMessage(() => resolve("resume", config), "no files available", config, "resume");
  rmSync(d, { recursive: true, force: true });
});

test("malformed JSON is treated the same as no config", () => {
  const d = dir();
  const config = configAt(d, "{ not json");

  assert.deepEqual(keys(config), []);
  throwsWithMessage(() => resolve("resume", config), "no files available");
  rmSync(d, { recursive: true, force: true });
});

test("an empty object is treated the same as no config", () => {
  const d = dir();
  const config = configAt(d, {});

  assert.deepEqual(keys(config), []);
  throwsWithMessage(() => resolve("resume", config), "no files available");
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

// ---- attaching from the panel ----------------------------------------------
//
// The attachment store lives beside whatever config it belongs to, so pointing
// at a temp .endo-files.json isolates the whole thing — including the copies on
// disk — without a second path argument on every call.

const bytes = (s: string) => Buffer.from(s, "utf8");

test("an attached file gets a key from its name, and resolve finds it", () => {
  const d = dir();
  const config = join(d, ".endo-files.json"); // never written: nothing is configured by hand

  const added = attach("Resume 2026.pdf", bytes("%PDF-1.4 hello"), config);

  assert.equal(added.key, "resume_2026");
  assert.equal(added.fixed, false);
  assert.deepEqual(keys(config), ["resume_2026"]);
  assert.equal(readFileSync(resolve("resume_2026", config), "utf8"), "%PDF-1.4 hello");
  rmSync(d, { recursive: true, force: true });
});

test("attaching never writes to the hand-edited config", () => {
  const d = dir();
  const target = join(d, "mine.pdf");
  writeFileSync(target, "pdf bytes");
  const config = configAt(d, { resume: target });
  const before = readFileSync(config, "utf8");

  attach("cover.txt", bytes("dear hiring manager"), config);

  assert.equal(readFileSync(config, "utf8"), before, ".endo-files.json must be left exactly as the human wrote it");
  // Both halves of the allow-list are reachable through the one resolve().
  assert.deepEqual(keys(config).sort(), ["cover", "resume"]);
  rmSync(d, { recursive: true, force: true });
});

test("a second file of the same name gets its own key instead of replacing the first", () => {
  const d = dir();
  const config = join(d, ".endo-files.json");

  const first = attach("resume.pdf", bytes("older"), config);
  const second = attach("resume.pdf", bytes("newer"), config);

  assert.equal(first.key, "resume");
  assert.equal(second.key, "resume_2");
  assert.equal(readFileSync(resolve("resume", config), "utf8"), "older");
  assert.equal(readFileSync(resolve("resume_2", config), "utf8"), "newer");
  rmSync(d, { recursive: true, force: true });
});

test("a hand-configured key is never shadowed by an attachment of the same name", () => {
  const d = dir();
  const target = join(d, "the-real-one.pdf");
  writeFileSync(target, "the human's copy");
  const config = configAt(d, { resume: target });

  const added = attach("resume.pdf", bytes("the attached copy"), config);

  assert.equal(added.key, "resume_2");
  assert.equal(resolve("resume", config), target);
  rmSync(d, { recursive: true, force: true });
});

// The name arrives over the panel socket as a string and is about to become
// part of a path this process WRITES to. The key is built out of [a-z0-9_]
// only, so a traversal cannot survive to describe a location.
test("a filename cannot steer the copy out of the bridge's own directory", () => {
  const d = dir();
  const config = join(d, ".endo-files.json");
  const store = join(d, ".endo-attachments");

  for (const hostile of ["../../evil.sh", "..\\..\\evil.sh", "/etc/passwd", "C:\\Windows\\evil.dll"]) {
    const added = attach(hostile, bytes("x"), config);
    const path = resolve(added.key, config);
    assert.equal(dirname(path), store, `${hostile} escaped to ${path}`);
    assert.match(added.key, /^[a-z0-9_]+$/);
  }
  rmSync(d, { recursive: true, force: true });
});

test("a name with nothing usable in it still produces a sayable key", () => {
  const d = dir();
  const config = join(d, ".endo-files.json");

  assert.equal(attach("...", bytes("x"), config).key, "file");
  assert.equal(attach("###.pdf", bytes("x"), config).key, "file_2");
  rmSync(d, { recursive: true, force: true });
});

// docs.ts dispatches on the extension, so a .docx that loses its suffix is read
// as raw zip bytes and refused — the suffix is behaviour, not decoration.
test("the extension survives, and a bogus one does not", () => {
  const d = dir();
  const config = join(d, ".endo-files.json");

  assert.ok(resolve(attach("notes.DOCX", bytes("x"), config).key, config).endsWith(".docx"));
  // Not an extension, just a dot in the name — must not become one.
  assert.ok(resolve(attach("v1.2 final", bytes("x"), config).key, config).endsWith("v1_2_final"));
  rmSync(d, { recursive: true, force: true });
});

test("empty and oversized payloads are refused before anything is written", () => {
  const d = dir();
  const config = join(d, ".endo-files.json");

  // Buffer.from(garbage, "base64") drops what it cannot decode rather than
  // throwing, so "did not arrive intact" and "really is empty" are one case.
  throwsWithMessage(() => attach("resume.pdf", Buffer.alloc(0), config), "empty");
  throwsWithMessage(() => attach("huge.bin", Buffer.alloc(MAX_ATTACH_BYTES + 1), config), "the limit is 25MB");
  throwsWithMessage(() => attach("", bytes("x"), config), "needs a name");

  assert.deepEqual(keys(config), []);
  assert.equal(existsSync(join(d, ".endo-attachments")), false);
  rmSync(d, { recursive: true, force: true });
});

test("detaching drops the key and deletes the copy", () => {
  const d = dir();
  const config = join(d, ".endo-files.json");
  const added = attach("resume.pdf", bytes("x"), config);
  const path = resolve(added.key, config);

  detach(added.key, config);

  assert.deepEqual(keys(config), []);
  assert.equal(existsSync(path), false);
  // Clicking a chip twice, or a key that never existed, is not an error.
  assert.doesNotThrow(() => detach(added.key, config));
  assert.doesNotThrow(() => detach("never-existed", config));
  rmSync(d, { recursive: true, force: true });
});

test("detach refuses to delete a hand-configured file", () => {
  const d = dir();
  const target = join(d, "resume.pdf");
  writeFileSync(target, "the human's copy");
  const config = configAt(d, { resume: target });

  detach("resume", config);

  assert.equal(existsSync(target), true, "the panel must never delete a file it did not put there");
  assert.deepEqual(keys(config), ["resume"]);
  rmSync(d, { recursive: true, force: true });
});

test("list marks hand-configured files fixed and attached ones removable", () => {
  const d = dir();
  const target = join(d, "mine.pdf");
  writeFileSync(target, "pdf bytes");
  const config = configAt(d, { resume: target });
  attach("cover.txt", bytes("dear hiring manager"), config);

  const listed = list(config);

  assert.deepEqual(
    listed.map(({ key, name, fixed }) => ({ key, name, fixed })).sort((a, b) => a.key.localeCompare(b.key)),
    [
      { key: "cover", name: "cover.txt", fixed: false },
      { key: "resume", name: "mine.pdf", fixed: true },
    ],
  );
  assert.equal(listed.find((f) => f.key === "cover")?.size, 19);
  rmSync(d, { recursive: true, force: true });
});

// A chip for something resolve() would refuse is worse than no chip: it says
// the agent has a file it does not have.
test("list drops a key whose file has gone", () => {
  const d = dir();
  const config = configAt(d, { ghost: join(d, "gone.pdf") });

  assert.deepEqual(list(config), []);
  rmSync(d, { recursive: true, force: true });
});
