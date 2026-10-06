import assert from "node:assert/strict";
import test from "node:test";
import { FINDING_HEAD, renderFinding, sanitize } from "./delivery.js";
import { clipTurn, formatRecentContext } from "./recent.js";

// ── 装配 ───────────────────────────────────────────────────────────
//
// 契约（2026-10-06 定稿，见 jiwen-bridge/_test/文案草稿-研究结论.md）：
//   · 产物必须**多行**，下游 Serein 按行剥离，压单行会让整块被吞。
//   · 整段**不得出现【】**，否则 Serein 提前关掉跳过态、产物泄漏进归档。
//   · 小标题是裸行（不带【】）。

test("产物是多行：标题 / 网址 / 原图 / 摘要各占一行", () => {
  const text = renderFinding({
    candidate: {
      source: "Aeon Essays",
      title: "Who will taste\nthe cherries?",
      url: "https://aeon.co/essays/x",
      summary: "old summary",
      image: "https://img.example/a.jpg"
    },
    note: "一段切片。\n换行也压掉"
  });
  const lines = text.split("\n");
  assert.equal(lines.length, 5, text);
  assert.equal(lines[0], FINDING_HEAD);
  assert.equal(lines[1], "Who will taste the cherries?");   // 标题内的换行压掉
  assert.equal(lines[2], "https://aeon.co/essays/x");
  assert.equal(lines[3], "https://img.example/a.jpg");
  assert.equal(lines[4], "一段切片。 换行也压掉");            // 摘要内的换行压掉
  // 单行内部仍不能有残留的 \r
  assert.equal(text.includes("\r"), false);
});

test("整段不得出现【】：内层小标题带【】会泄漏产物", () => {
  const text = renderFinding({
    candidate: {
      source: "ArchDaily",
      title: "【陷阱】标题带书名号",
      url: "https://www.archdaily.com/1",
      summary: "",
      image: ""
    },
    note: "摘要【也带】"
  });
  assert.equal(text.includes("【"), false, text);
  assert.equal(text.includes("】"), false, text);
  assert.ok(text.startsWith(FINDING_HEAD), text);
});

test("小标题是裸行，不带【】", () => {
  assert.equal(FINDING_HEAD.startsWith("【"), false, FINDING_HEAD);
  const text = renderFinding({
    candidate: { source: "Aeon", title: "T", url: "https://a.co/x", summary: "", image: "" },
    note: "切片"
  });
  assert.equal(text.split("\n")[0], "之前独处冲浪时发现的东西：");
});

test("无图时整项略掉，不留空壳", () => {
  const text = renderFinding({
    candidate: { source: "arXiv", title: "T", url: "https://arxiv.org/abs/1", summary: "", image: "" },
    note: "切片"
  });
  assert.equal(text.split("https://").length - 1, 1, text);
  assert.equal(text.split("\n").length, 4, text);   // 小标题 / 标题 / 网址 / 摘要
});

test("块内不含空行（Serein 不把空行当出块信号）", () => {
  const text = renderFinding({
    candidate: { source: "Aeon", title: "T", url: "https://a.co/x", summary: "", image: "" },
    note: ""
  });
  assert.equal(text.split("\n").some((l) => l.trim() === ""), false, text);
});

test("sanitize 压换行、压多空格、剥【】", () => {
  assert.equal(sanitize("  a\r\n\nb   c 【x】 "), "a b c x");
  assert.equal(sanitize(""), "");
});

// ── 最近原文 ───────────────────────────────────────────────────────

test("原文段落为空时不出现（没有原文那整段整个不进提示词）", () => {
  assert.equal(formatRecentContext([]), "");
});

test("原文按时间倒序编号，最新在前", () => {
  const text = formatRecentContext([
    { role: "assistant", text: "最新的那句" },
    { role: "assistant", text: "上一句" }
  ]);
  assert.ok(text.indexOf("[1] 最新的那句") < text.indexOf("[2] 上一句"));
});

test("clipTurn 截断时按句断开，不留半句", () => {
  // 后半段有句号可断→ 用那个断点收尾
  const withBreak = "开头的铺垫铺垫铺垫铺垫。" + "填充".repeat(20) + "这里该收尾了。";
  const a = clipTurn({ role: "assistant", text: withBreak }, 60);
  assert.ok(a.text.length <= 60, String(a.text.length));
  assert.ok(a.text.endsWith("。"), a.text);

  // 整个前半段没有句号 → 退化为硬截（不能凭空造句号）
  const noBreak = "一".repeat(200);
  const b = clipTurn({ role: "assistant", text: noBreak }, 50);
  assert.equal(b.text.length, 50);
});

test("clipTurn 短文本原样返回", () => {
  const turn = { role: "assistant" as const, text: "短。" };
  assert.equal(clipTurn(turn, 400).text, "短。");
});