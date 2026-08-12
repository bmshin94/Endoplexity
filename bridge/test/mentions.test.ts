import { test } from "node:test";
import assert from "node:assert/strict";

// mentions.js is DOM-free for this reason — the menu is panel.js's problem and
// needs a real Chrome, but which tabs get SENT is a rule, and getting it wrong
// points the agent at a page the user thought they had removed.
import { block, kept, label } from "../../extension/mentions.js";

const tab = (id: number, title: string, url = `https://x${id}.test/`) => ({ id, title, url });
const mention = (id: number, title: string, url = `https://x${id}.test/`) => ({
  id,
  title,
  url,
  label: label({ title, url }),
});

test("a long title is clipped, so the label fits a 360px composer", () => {
  const long = label(tab(1, "Compare the free tiers of every static host on the internet"));
  assert.ok(long.length <= 32, `${long.length} chars is wider than the composer`);
  assert.match(long, /…$/, "clipping has to be visible, or the label reads as the whole title");
});

test("a title's newlines and runs of spaces collapse — the label goes into one line of a textarea", () => {
  assert.equal(label(tab(1, "  Vercel\n  Pricing  ")), "Vercel Pricing");
});

test("a titleless tab falls back to its url rather than an empty @", () => {
  assert.equal(label({ title: "", url: "https://vercel.com/" }), "https://vercel.com/");
});

test("only the mentions still written in the box are sent", () => {
  const on = [mention(5, "Vercel Pricing"), mention(9, "Netlify Pricing")];
  // The user mentioned both, then backspaced the second one away.
  const text = "compare @Vercel Pricing with the current page";
  assert.deepEqual(
    kept(text, on).map((m) => m.id),
    [5],
    "a mention deleted from the box must not still ride along in the prompt",
  );
});

test("the block names the id, because use_tab takes an id and nothing else", () => {
  const text = "compare @Vercel Pricing and @Netlify Pricing";
  const out = block(text, [mention(5, "Vercel Pricing", "https://vercel.com/pricing"), mention(9, "Netlify Pricing")]);
  assert.match(out!, /use_tab/, "the block has to name the call it is for");
  assert.match(out!, /id 5 — "Vercel Pricing" https:\/\/vercel\.com\/pricing/);
  assert.match(out!, /id 9 —/);
});

test("no mention means no block at all — an empty heading is pure token cost", () => {
  assert.equal(block("just summarise this page", []), null);
  assert.equal(block("just summarise this page", [mention(5, "Vercel Pricing")]), null);
});

test("the same tab mentioned twice is one line, not two", () => {
  // panel.js dedupes by id on insert, so the second @label matches the one entry.
  const on = [mention(5, "Vercel Pricing")];
  assert.equal(kept("@Vercel Pricing vs @Vercel Pricing", on).length, 1);
});
