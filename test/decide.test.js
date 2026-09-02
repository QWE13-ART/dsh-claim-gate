import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/index.js";

// 新契约：所有事件必须带 data.turn（decide 按 e.data.turn === turn 过滤，不再用 turn/start 位置）
const start = (turn) => ({ seq: 0, type: "turn/start", data: { turn } });
const claim = (turn, text) => ({ seq: 2, type: "assistant/message", data: { turn, text } });
const call = (turn, name, args) => ({ seq: 1, type: "tool/call", data: { turn, name, arguments: args } });

test("声称已落地 + 无任何工具 → unverified", () => {
  const r = decide([start(1), claim(1, "6 个借鉴点已落地")], 1);
  assert.equal(r.verdict, "unverified");
  assert.equal(r.claim, "已落地");
});

test("声称已修复 + grep 验证过 → ok", () => {
  const r = decide([start(1), call(1, "grep", { pattern: "foo" }), claim(1, "已修复")], 1);
  assert.equal(r.verdict, "ok");
});

test("没有声称 → no-claim（不干预正常对话）", () => {
  const r = decide([start(1), claim(1, "我看了一下这个文件")], 1);
  assert.equal(r.verdict, "no-claim");
});

test("pwsh 但只是 echo（非验证命令）→ 仍 unverified", () => {
  const r = decide([start(1), call(1, "pwsh", { command: "echo hi" }), claim(1, "已完成")], 1);
  assert.equal(r.verdict, "unverified");
});

test("pwsh 跑了 Test-Path → ok", () => {
  const r = decide([start(1), call(1, "pwsh", { command: "Test-Path E:\\x" }), claim(1, "已完成")], 1);
  assert.equal(r.verdict, "ok");
});

test("只看本轮：上一轮的验证不算数", () => {
  const events = [
    start(1),
    claim(1, "已修复"),
    call(1, "grep", { pattern: "old" }),
    start(2),
    claim(2, "已落地")
  ];
  assert.equal(decide(events, 2).verdict, "unverified"); // 第 2 轮无验证
  assert.equal(decide(events, 1).verdict, "ok"); // 第 1 轮有验证
});

test("content 数组形状也能取到文本", () => {
  const e = { seq: 2, type: "assistant/message", data: { turn: 1, content: [{ text: "已生效" }] } };
  assert.equal(decide([start(1), e], 1).verdict, "unverified");
});

test("data.turn 不匹配的事件自动跳过（不污染判定）", () => {
  // 前面有工具但属于 turn 1，turn 2 无工具+有声明 → unverified
  assert.equal(decide([start(1), call(1, "grep", {}), start(2), claim(2, "已完成")], 2).verdict, "unverified");
});

test("没有 data.turn 的事件自动跳过", () => {
  assert.equal(decide([{ type: "assistant/message", data: { text: "已完成" } }], 1).verdict, "no-claim");
});

test("坏数据不抛异常", () => {
  assert.doesNotThrow(() => decide([null, { seq: 1 }, { seq: 2, type: "assistant/message" }], 1));
});