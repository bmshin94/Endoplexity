import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { extract, page } from "../src/docs.ts";

const dir = mkdtempSync(join(tmpdir(), "endo-docs-test-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Build a real zip, deflated, with a real central directory — the same shape
 * Word and Excel write. Committing binary .docx fixtures would test the same
 * code against bytes nobody in this repo can read or change; this way the
 * fixture is the test.
 */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, "utf8");
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

let n = 0;
const write = (name: string, body: Buffer | string) => {
  const path = join(dir, `${n++}-${name}`);
  writeFileSync(path, body);
  return path;
};

async function rejects(path: string, ...substrings: string[]) {
  await assert.rejects(extract(path), (err: unknown) => {
    const msg = (err as Error).message;
    for (const s of substrings) assert.ok(msg.includes(s), `expected ${JSON.stringify(s)} in: ${msg}`);
    return true;
  });
}

// ------------------------------------------------------------------ docx

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test("docx: paragraphs become lines, entities decode, field codes do not leak", async () => {
  const path = write(
    "cv.docx",
    zip({
      "word/document.xml":
        `<?xml version="1.0"?><w:document><w:body>` +
        para("Jane Q. Public") +
        para("Engineer &amp; occasional &lt;script&gt; author") +
        `<w:p><w:r><w:instrText> HYPERLINK "mailto:jane@example.com" </w:instrText></w:r><w:r><w:t>jane@example.com</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Left</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Right</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    }),
  );

  const text = await extract(path);
  assert.equal(
    text,
    "Jane Q. Public\nEngineer & occasional <script> author\njane@example.com\nLeft\tRight",
  );
  assert.ok(!text.includes("HYPERLINK"), "the field code should not survive");
});

test("docx: a soft line break is a line, and runs inside a paragraph stay joined", async () => {
  const path = write(
    "note.docx",
    zip({
      "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>${para("three")}</w:body></w:document>`,
    }),
  );
  assert.equal(await extract(path), "one\ntwo\nthree");
});

test("docx: a zip without word/document.xml names what is missing", async () => {
  await rejects(write("empty.docx", zip({ "docProps/app.xml": "<Properties/>" })), "missing word/document.xml");
});

test("docx: a file that is not a zip at all says so", async () => {
  await rejects(write("fake.docx", "this is just text pretending"), "not a zip file");
});

// ------------------------------------------------------------------ xlsx

/** The four parts every real xlsx has, so each test only states its own data. */
function book(sheets: Record<string, string>, shared: string[] = [], styles?: string) {
  const names = Object.keys(sheets);
  const files: Record<string, string> = {
    "xl/workbook.xml": `<workbook><sheets>${names
      .map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${names
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
    "xl/sharedStrings.xml": `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
  };
  names.forEach((name, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${sheets[name]}</sheetData></worksheet>`;
  });
  if (styles) files["xl/styles.xml"] = styles;
  return zip(files);
}

test("xlsx: shared strings resolve and rows come back as tab-separated lines", async () => {
  const path = write(
    "data.xlsx",
    book(
      {
        Revenue: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
                  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c></row>`,
      },
      ["Product", "Amount", "Widget"],
    ),
  );
  assert.equal(await extract(path), "## Revenue\n\nProduct\tAmount\nWidget\t1200");
});

test("xlsx: an empty cell keeps its column instead of shifting the row left", async () => {
  const path = write(
    "gap.xlsx",
    // B2 is absent entirely, which is how Excel stores a blank cell.
    book({ Sheet1: `<row r="2"><c r="A2"><v>1</v></c><c r="C2"><v>3</v></c></row>` }),
  );
  assert.equal(await extract(path), "## Sheet1\n\n1\t\t3");
});

// 44927 = 2023-01-01 is the standard anchor for Excel's serial dates; +365 is
// 2024-01-01 (45292) and +366 is 2025-01-01 (45658), which puts 45678 at
// 2025-01-21. Both are asserted so the leap-year fudge cannot drift by a day
// without a test naming the day it drifted to.
test("xlsx: a date-formatted number reads as a date, a plain one stays a number", async () => {
  const path = write(
    "dates.xlsx",
    book(
      {
        Sheet1:
          `<row r="1"><c r="A1" s="1"><v>45678</v></c><c r="B1" s="0"><v>45678</v></c></row>` +
          `<row r="2"><c r="A2" s="1"><v>44927</v></c></row>`,
      },
      [],
      // xf index 1 wears built-in format 14 (a short date); index 0 is General.
      `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
  );
  assert.equal(await extract(path), "## Sheet1\n\n2025-01-21\t45678\n2023-01-01");
});

test("xlsx: a date with a time keeps the time", async () => {
  const path = write(
    "when.xlsx",
    book(
      { Sheet1: `<row r="1"><c r="A1" s="0"><v>45678.5</v></c></row>` },
      [],
      `<styleSheet><cellXfs count="1"><xf numFmtId="22"/></cellXfs></styleSheet>`,
    ),
  );
  assert.equal(await extract(path), "## Sheet1\n\n2025-01-21 12:00:00");
});

test("xlsx: a CUSTOM date format is recognised by its format code", async () => {
  const path = write(
    "custom.xlsx",
    book(
      { Sheet1: `<row r="1"><c r="A1" s="0"><v>45678</v></c></row>` },
      [],
      `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>` +
        `<cellXfs count="1"><xf numFmtId="164"/></cellXfs></styleSheet>`,
    ),
  );
  assert.equal(await extract(path), "## Sheet1\n\n2025-01-21");
});

test("xlsx: booleans and inline strings read as themselves", async () => {
  const path = write(
    "types.xlsx",
    book({
      Sheet1: `<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c>` +
        `<c r="C1" t="inlineStr"><is><t>typed here</t></is></c></row>`,
    }),
  );
  assert.equal(await extract(path), "## Sheet1\n\nTRUE\tFALSE\ttyped here");
});

test("xlsx: sheets are named and ordered by the workbook, not by file name", async () => {
  // rId1 -> sheet1.xml is "Summary", so a reader that guessed alphabetically
  // or by file order would still pass; the second sheet is what pins it.
  const path = write("two.xlsx", book({ Summary: `<row r="1"><c r="A1"><v>1</v></c></row>`, Detail: `<row r="1"><c r="A1"><v>2</v></c></row>` }));
  const text = await extract(path);
  assert.match(text, /^## Summary\n\n1\n\n## Detail\n\n2$/);
});

// ------------------------------------------------------------------ pptx

test("pptx: slides are numbered in slide order, not central-directory order", async () => {
  const slide = (t: string) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const path = write(
    "deck.pptx",
    // Written out of order, and with a slide10 that sorts before slide2 as a string.
    zip({
      "ppt/slides/slide10.xml": slide("tenth"),
      "ppt/slides/slide2.xml": slide("second"),
      "ppt/slides/slide1.xml": slide("first"),
    }),
  );
  assert.equal(await extract(path), "## Slide 1\n\nfirst\n\n## Slide 2\n\nsecond\n\n## Slide 3\n\ntenth");
});

// ------------------------------------------------------------------ pdf

test("pdf: text comes out of a real PDF", async () => {
  const path = fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url));
  assert.equal(await extract(path), "Endoplexity reads this line.\nAnd this second one.");
});

// ------------------------------------------------------------------ text

test("plain text comes back untouched, whatever the extension", async () => {
  const body = "# Notes\n\n- one\n- two\n";
  assert.equal(await extract(write("notes.md", body)), body);
  assert.equal(await extract(write("data.csv", "a,b\n1,2\n")), "a,b\n1,2\n");
  // No extension list to be on: sniffing the bytes is what makes a source
  // file readable without this module learning every language there is.
  assert.equal(await extract(write("script.rs", "fn main() {}\n")), "fn main() {}\n");
  assert.equal(await extract(write("hosts", "127.0.0.1 localhost\n")), "127.0.0.1 localhost\n");
});

test("a binary file is refused rather than returned as mojibake", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
  await rejects(write("blob.bin", png), "not text");
});

test("an image says why it cannot be read, rather than failing as binary", async () => {
  await rejects(write("shot.png", "not really a png"), "image has none");
});

test("the old binary Office formats name the fix", async () => {
  await rejects(write("old.doc", " binary compound file"), ".docx");
  await rejects(write("old.xls", " binary compound file"), ".xlsx");
});

test("an empty file says it is empty instead of returning nothing", async () => {
  await rejects(write("blank.txt", ""), "is empty");
});

test("a file that does not exist names itself rather than throwing an ENOENT", async () => {
  await assert.rejects(extract(join(dir, "no-such-file.txt")));
});

// ------------------------------------------------------------------ paging

test("a document that fits comes back with no notice attached", () => {
  assert.equal(page("short enough", 0, 100, "cv"), "short enough");
  // Exactly the cap is still whole — an off-by-one here would tell the agent
  // to fetch a second page containing nothing.
  assert.equal(page("abcde", 0, 5, "cv"), "abcde");
});

test("a long document pages, and the notice names the call that continues it", () => {
  const first = page("abcdefghij", 0, 4, "cv");
  assert.equal(first, 'abcd\n\n[6 more characters — continue with read_file file: "cv", from: 4]');

  const second = page("abcdefghij", 4, 4, "cv");
  assert.equal(second, 'efgh\n\n[2 more characters — continue with read_file file: "cv", from: 8]');

  assert.equal(page("abcdefghij", 8, 4, "cv"), "ij");
});

test("a from past the end returns nothing rather than throwing or looping", () => {
  assert.equal(page("abc", 99, 10, "cv"), "");
  assert.equal(page("abc", -5, 10, "cv"), "abc");
});
