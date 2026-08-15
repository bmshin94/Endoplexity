import { test } from "node:test";
import assert from "node:assert/strict";

// DOM-free for the same reason mentions.js is: the chips need a real Chrome,
// but what the model is TOLD about a file is a rule, and getting it wrong means
// an agent that has a resume and does not know it can read it.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { block, humanSize, toBase64 } from "../../extension/attachments.js";
import { attach, resolve } from "../src/files.ts";
import { extract } from "../src/docs.ts";

const file = (key: string, name: string, size = 4891, fixed = false) => ({ key, name, size, fixed });

test("sizes read the way a human checks a file, not the way a byte counter does", () => {
  assert.equal(humanSize(0), "0 B");
  assert.equal(humanSize(940), "940 B");
  assert.equal(humanSize(4891), "5 KB");
  assert.equal(humanSize(2_411_724), "2.3 MB");
});

test("nothing attached means no block at all, not an empty heading", () => {
  assert.equal(block([]), null);
  assert.equal(block(undefined), null);
});

// The keys are the whole point of the block: they are the only thing either
// tool accepts, and the model has no other way to learn them.
test("every key is named, in the form the tools take", () => {
  const text = block([file("resume", "resume.pdf"), file("cover_letter", "cover_letter.docx", 18_204)]);
  assert.match(text, /key "resume" — resume\.pdf \(5 KB\)/);
  assert.match(text, /key "cover_letter" — cover_letter\.docx \(18 KB\)/);
});

// Which tool to reach for is not guessable from a filename — "what are my last
// three jobs" is read_file and "apply to this" is upload, on the same file.
test("both tools are named, and so is the fact that nothing else is reachable", () => {
  const text = block([file("resume", "resume.pdf")]);
  assert.match(text, /read_file/);
  assert.match(text, /upload/);
  assert.match(text, /no other file/i);
});

// A hand-configured file and an attached one are the same thing to the agent:
// a key it may pass to two tools. `fixed` only decides whether the panel draws
// a remove button, and must not leak into what the model reads.
test("a hand-configured file is described exactly like an attached one", () => {
  assert.equal(block([file("resume", "resume.pdf", 4891, true)]), block([file("resume", "resume.pdf", 4891, false)]));
});

// ---- the wire ---------------------------------------------------------------
//
// The seam between two halves that are each already green: the panel encodes,
// the bridge decodes, and nothing until now has run one into the other. A file
// crosses that boundary exactly once and silently — a chunking bug would store
// bytes that are subtly not the file, and the first symptom would be a PDF
// parser failing on a document the user can open perfectly well themselves.

test("the panel's encoder and the bridge's decoder agree, across the chunk boundary", () => {
  // Every byte value, repeated well past the 0x8000 chunk — so a chunk that
  // split a 3-byte base64 group, or a byte that survived only because it was
  // ASCII, shows up as a mismatch rather than as a lucky pass.
  const every = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 256));

  const encoded = toBase64(every);

  assert.equal(encoded, every.toString("base64"));
  assert.deepEqual(Buffer.from(encoded, "base64"), every, "the bytes must survive the round trip exactly");
});

test("a real PDF goes panel-side bytes -> base64 -> the store -> readable text", async () => {
  const d = mkdtempSync(join(tmpdir(), "endo-wire-test-"));
  const config = join(d, ".endo-files.json");
  const pdf = readFileSync(new URL("./fixtures/hello.pdf", import.meta.url));

  // Exactly what the panel does with a File, and then what index.ts does with
  // the message it arrives in.
  const onTheWire = toBase64(pdf);
  const added = attach("My CV.pdf", Buffer.from(onTheWire, "base64"), config);

  assert.match(await extract(resolve(added.key, config)), /Endoplexity reads this line/);
  rmSync(d, { recursive: true, force: true });
});
