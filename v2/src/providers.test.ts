import assert from "node:assert/strict";
import test from "node:test";
import { parseSelection } from "./providers.js";

test("parses a fenced model selection", () => {
  assert.deepEqual(parseSelection('```json\n{"index":1,"summary":"一段脱水的客观切片"}\n```', 2), {
    index: 1,
    summary: "一段脱水的客观切片"
  });
});

test("rejects an out-of-range selection", () => {
  assert.throws(() => parseSelection('{"index":5,"summary":"x"}', 2), /invalid candidate index/);
});

test("rejects an empty summary", () => {
  assert.throws(() => parseSelection('{"index":0,"summary":"   "}', 2), /empty summary/);
});