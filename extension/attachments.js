/**
 * The files the agent can reach, and how they are described to it.
 *
 * DOM-free on purpose, like mentions.js and md.js — panel.js owns the chips and
 * the file input, this owns the two things that are easy to get quietly wrong:
 * how a size reads to a human, and what the model is told a file IS.
 *
 * The list itself lives in the bridge, not here. Chrome tears the side panel
 * document down on every window switch, so anything the panel held alone would
 * vanish several times an hour; the bridge sends it on every `hello`.
 *
 * A file is handed over as a KEY, never as content and never as a path — the
 * same rule as an @-mention handing over a tab id. Inlining the text instead
 * would put a whole document into every turn of the conversation whether it was
 * needed or not, and the model is perfectly able to call read_file when the
 * answer is actually in the file.
 */

/**
 * A file's bytes as base64, for the one JSON message that carries it over.
 *
 * Lives here rather than in panel.js because it is pure, and because the
 * chunking is not an optimisation: btoa takes a string, and the obvious
 * String.fromCharCode(...bytes) spreads every byte as a call argument and
 * overflows the stack somewhere past ~100k of them. That is the worst kind of
 * limit — a resume survives it and a portfolio PDF does not, so it only ever
 * breaks on the file that mattered. Chunked, there is no limit worth naming.
 */
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // 0x8000 is the usual safe argument count, and a multiple of 3 — base64
  // encodes in 3-byte groups, so a chunk that split one would pad mid-stream
  // and produce a string that decodes to different bytes.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Sizes are context, not data — one glance to see a resume is not a video. */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The context block, or null if there is nothing attached.
 *
 * Names both tools, because which one is wanted depends on the task and the
 * distinction is not guessable from a filename: "what are my last three jobs"
 * is read_file, "apply to this" is upload, and a task can want both of the same
 * file. Saying so costs one line and saves a wrong first call.
 */
export function block(files) {
  if (!files?.length) return null;
  return [
    "Files the user has made available. read_file reads one as text; upload puts one into a file input on the page. Both take the KEY, and no other file can be reached:",
    ...files.map((f) => `  key "${f.key}" — ${f.name} (${humanSize(f.size)})`),
  ].join("\n");
}
