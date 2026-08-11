import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Turn a file on disk into text the model can read.
 *
 * `upload` pushes a file at a form field and the agent never learns what is in
 * it; this is the other half — the agent reads the document. It deliberately
 * takes a PATH and knows nothing about keys: mcp.ts resolves the key through
 * files.ts exactly as `upload` does, so the invariant that the model never
 * names a path is enforced in one place for both tools.
 *
 * Office formats are zips of XML, so `node:zlib` plus a central-directory
 * walk covers docx/xlsx/pptx with no dependency. PDF is the exception — text
 * extraction there is a real parser (content streams, font encodings, column
 * ordering) and `unpdf` is the one dependency this file earns.
 */

// ---------------------------------------------------------------- zip

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/**
 * Read the named entries out of a zip. `wanted` runs on every entry name and
 * only matches get inflated, so opening an xlsx does not decompress its images.
 *
 * ponytail: no zip64. It kicks in past 65,535 entries or 4GB, which an
 * office document reaches only if something has already gone wrong; the EOCD
 * lookup below simply fails to find its record and says "not a zip file".
 */
function unzip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  // The end-of-central-directory record is last, except a trailing comment can
  // push it up to 65,535 bytes back — so scan backwards for its signature
  // rather than assuming it sits at exactly buf.length - 22.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;

    // Sizes come from the central directory because a local header is allowed
    // to zero them and put the real ones in a trailing data descriptor (flag
    // bit 3) — Word and Excel both do this when streaming a file out. The
    // local header is still the only place that says how far past itself the
    // data starts, since its extra field length can differ from the central
    // one's.
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + compressed);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
  }
  return out;
}

// ---------------------------------------------------------------- xml

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Every tag dropped, entities decoded. Callers turn the tags they want to
 *  keep into whitespace FIRST — everything left is markup with no text of its
 *  own, because these formats keep all text in leaf elements. */
function stripTags(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]*>/g, ""));
}

/** The text of every element with this local name, in document order. */
function textOf(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*?(/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, "g");
  for (const m of xml.matchAll(re)) out.push(m[1] === "/>" ? "" : decodeEntities(m[2] ?? ""));
  return out;
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

/** Collapse the run of blank lines these formats leave behind, and trim. */
function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function entry(files: Map<string, Buffer>, name: string, kind: string): string {
  const found = files.get(name);
  if (!found) throw new Error(`${kind} is missing ${name} — it may be corrupt, or not really a ${kind}`);
  return found.toString("utf8");
}

// ---------------------------------------------------------------- docx / pptx

function docx(buf: Buffer): string {
  const xml = entry(unzip(buf, (n) => n === "word/document.xml"), "word/document.xml", "docx");
  return tidy(
    stripTags(
      xml
        // Field codes (HYPERLINK "mailto:…", PAGE, TOC) live in text elements
        // like the prose does, so they survive stripTags and read as garbage
        // in the middle of a sentence. Drop them whole.
        .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, "")
        .replace(/<w:tab\b[^>]*\/>/g, "\t")
        .replace(/<w:br\b[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n"),
    ),
  );
}

function pptx(buf: Buffer): string {
  const files = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  // Map order is central-directory order, which is not slide order.
  const names = [...files.keys()].sort(
    (a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]),
  );
  if (names.length === 0) throw new Error("pptx has no slides — it may be corrupt, or not really a pptx");

  return names
    .map((name, i) => {
      const body = tidy(stripTags(files.get(name)!.toString("utf8").replace(/<\/a:p>/g, "\n")));
      return `## Slide ${i + 1}\n\n${body}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------- xlsx

/** "A" -> 0, "C" -> 2, "AA" -> 26. The letters of a cell ref like "C5". */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Excel dates are plain numbers wearing a date format, so a sheet read without
 * styles.xml reports "45678" where the human sees "2025-01-15" — an agent then
 * states that as fact. Worth the ~20 lines: cellXfs gives each cell's
 * numFmtId, and the built-in date formats plus any custom one containing y/d/m
 * mark it as a date.
 */
function dateFormats(files: Map<string, Buffer>): Set<number> {
  const xml = files.get("xl/styles.xml")?.toString("utf8");
  if (!xml) return new Set();
  // 14-22 are the built-in date and time formats, 45-47 the elapsed-time ones.
  const dateFmts = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  for (const tag of xml.match(/<numFmt\b[^>]*\/>/g) ?? []) {
    const id = Number(attr(tag, "numFmtId"));
    const code = attr(tag, "formatCode") ?? "";
    // Strip the literal text sections a format can carry ("yr" in quotes is
    // not a year token) before looking for date letters.
    if (Number.isFinite(id) && /[yd]|mmm/.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ""))) dateFmts.add(id);
  }

  const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  const styles = new Set<number>();
  [...(cellXfs.match(/<xf\b[^>]*\/?>/g) ?? [])].forEach((tag, i) => {
    if (dateFmts.has(Number(attr(tag, "numFmtId")))) styles.add(i);
  });
  return styles;
}

function serialToDate(serial: number): string {
  // Excel's epoch is 1899-12-30 rather than 12-31 because it wrongly counts
  // 1900 as a leap year; that makes every date from 1900-03-01 on correct.
  // ponytail: the 60 days before that are off by one — a 1900 date in a
  // spreadsheet is a data-entry accident far more often than a real date.
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
  const iso = new Date(ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
}

function xlsx(buf: Buffer): string {
  const files = unzip(
    buf,
    (n) =>
      n === "xl/workbook.xml" ||
      n === "xl/_rels/workbook.xml.rels" ||
      n === "xl/sharedStrings.xml" ||
      n === "xl/styles.xml" ||
      /^xl\/worksheets\/.+\.xml$/.test(n),
  );

  // Every string in the book is pooled here and cells reference it by index.
  // An <si> can be several formatted runs, so take all its <t> children.
  const shared = (files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "")
    .split(/<si\b[^>]*>/)
    .slice(1)
    .map((si) => textOf(si, "t").join(""));

  const dateStyles = dateFormats(files);

  // Sheet order and names live in workbook.xml, but it names each sheet's file
  // only through an r:id — resolving that against the rels is the difference
  // between correct sheet names and hoping sheet1.xml is the first tab.
  const rels = new Map<string, string>();
  for (const tag of entry(files, "xl/_rels/workbook.xml.rels", "xlsx").match(/<Relationship\b[^>]*\/>/g) ?? []) {
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) rels.set(id, `xl/${target.replace(/^\/?xl\//, "")}`);
  }

  const book = entry(files, "xl/workbook.xml", "xlsx");
  const sheets = (book.match(/<sheet\b[^>]*\/>/g) ?? []).map((tag) => ({
    name: decodeEntities(attr(tag, "name") ?? "Sheet"),
    path: rels.get(attr(tag, "r:id") ?? ""),
  }));
  if (sheets.length === 0) throw new Error("xlsx has no sheets — it may be corrupt, or not really an xlsx");

  return sheets
    .map(({ name, path }) => {
      const xml = path && files.get(path) ? files.get(path)!.toString("utf8") : "";
      const rows = (xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []).map((row) => {
        const cells: string[] = [];
        for (const cell of row.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
          const open = cell.match(/<c\b[^>]*?\/?>/)![0];
          const type = attr(open, "t");
          const raw = type === "inlineStr" ? textOf(cell, "t").join("") : (textOf(cell, "v")[0] ?? "");

          let value = raw;
          if (type === "s") value = shared[Number(raw)] ?? "";
          else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
          else if (!type || type === "n") {
            const style = Number(attr(open, "s") ?? NaN);
            if (raw !== "" && dateStyles.has(style) && Number.isFinite(Number(raw))) value = serialToDate(Number(raw));
          }

          // Excel omits empty cells entirely, so writing values in the order
          // they appear silently shifts every column after a gap. Pad to the
          // cell's own column, which its r attribute states outright.
          const at = columnIndex(attr(open, "r") ?? "");
          while (cells.length < at) cells.push("");
          cells[at] = value.replace(/[\t\n]/g, " ");
        }
        return cells.join("\t");
      });
      return `## ${name}\n\n${rows.join("\n").trimEnd()}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------- plain text

/**
 * Anything whose bytes are text: .txt, .md, .csv, .json, and every source file
 * there is. Sniffing beats an extension list that would need a new entry for
 * every language — and the answer to "is this text" is in the bytes anyway.
 */
function asText(buf: Buffer): string | undefined {
  const text = buf.toString("utf8");
  // A NUL or a lone replacement char means it was not UTF-8 text; a stray
  // control character means it was some other binary format that happens to
  // decode. Tab, newline and carriage return are the legitimate ones.
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/.test(text)) return undefined;
  return text;
}

// ---------------------------------------------------------------- dispatch

const ZIPPED: Record<string, (buf: Buffer) => string> = {
  ".docx": docx,
  ".xlsx": xlsx,
  ".xlsm": xlsx,
  ".pptx": pptx,
};

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".ico"]);

/** The old binary Office formats, which are not zips and share nothing with
 *  the new ones — a compound-file parser, not a missing branch. */
const LEGACY_OFFICE = new Set([".doc", ".xls", ".ppt"]);

/**
 * One page of a document, plus the call that fetches the next one.
 *
 * A tool return crosses the model's context on every LATER turn as well, so a
 * whole 40k-character spreadsheet is paid ten times over a ten-turn task —
 * the same reason snapshot has a line cap. The notice names the literal next
 * call because a truncation message must only offer a recovery the agent can
 * actually perform.
 */
export function page(text: string, from: number | undefined, cap: number, file: string): string {
  const start = Math.min(Math.max(from ?? 0, 0), text.length);
  const body = text.slice(start, start + cap);
  const end = start + body.length;
  if (end >= text.length) return body;
  return `${body}\n\n[${text.length - end} more characters — continue with read_file file: ${JSON.stringify(file)}, from: ${end}]`;
}

// Read whole into memory, so a key pointed at something enormous is a bridge
// that dies rather than a tool that fails — and the bridge dying takes the
// session with it, since session state is in memory by design. 50MB is far
// past any real document and is checked before the read, not after.
const MAX_BYTES = 50 * 1024 * 1024;

export async function extract(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();

  const { size } = statSync(path);
  if (size === 0) throw new Error(`${path} is empty`);
  if (size > MAX_BYTES) {
    throw new Error(`${path} is ${Math.round(size / 1024 / 1024)}MB — too large to read (limit ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const buf = readFileSync(path);

  if (ext === ".pdf") {
    // Imported here rather than at the top so the bridge does not pay to load
    // a PDF engine at startup for the runs that never read one.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
    const trimmed = tidy(text);
    if (!trimmed) {
      throw new Error("this PDF has no text layer — it is probably a scan, which would need OCR to read");
    }
    return trimmed;
  }

  const zipped = ZIPPED[ext];
  if (zipped) return zipped(buf);

  if (IMAGES.has(ext)) throw new Error(`cannot read ${ext} — this tool returns text, and an image has none`);
  if (LEGACY_OFFICE.has(ext)) {
    throw new Error(`cannot read the old ${ext} format — ask the human to save it as ${ext}x`);
  }

  const text = asText(buf);
  if (text === undefined) {
    throw new Error(`cannot read ${ext || "this file"} — it is not text, and is not a pdf, docx, xlsx or pptx`);
  }
  return text;
}
