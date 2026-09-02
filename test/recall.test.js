// recall.test.js — v0.3 召回矩阵（红测试：先定义期望行为，再实现）
//
// v0.2 的结构性盲区（见 docs/v0.3-design.md F3）：8 条真实语料用例里真阳只有 2 条，
// 判据单向朝「少误报」优化，「该抓的没抓到」零防线。本文件补 recall 方向：
//   每条词表形态一真阳 · 每条守卫一防线 · 每条窗口边界一定义。
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/index.js";

const say = (turn, text) => ({ type: "assistant/message", data: { turn, message: { content: [{ type: "text", text }] } } });
const call = (turn, name, args) => ({ type: "tool/call", data: { turn, name, arguments: args || {} } });
const result = (turn, body) => ({ type: "tool/result", data: { turn, result: body } });
// 真实用户消息：source.kind !== "plugin"。归属 turn = 其前最近 turn/start（宿主实测模式：
// turn/start(N) → step/start(N) → user/message）。夹具里须在 userMsg 前放 st()。
const userMsg = (turn, text) => ({ type: "user/message", data: { turn, source: { kind: "user" }, content: text } });
const st = (turn) => ({ type: "turn/start", data: { turn } });

// ─────────── R1. 词表形态真阳：「X 完成」结构（F1：v0.2 全部漏掉）───────────

test("R1a 真阳：调研完成 + 零工具 → unverified", () => {
  const r = decide([userMsg(0, "去调研"), say(1, "调研完成——三个顶级源全部到手")], 1);
  assert.equal(r.verdict, "unverified", "v0.2 词表只有「已X」，「X 完成」全漏");
});

test("R1b 真阳：接入完成 + 仅写待办 → unverified（黑名单窗口内生效）", () => {
  const r = decide([userMsg(0, "接一下"), call(1, "todo_write", { todos: [] }), say(1, "7 个全部接入完成")], 1);
  assert.equal(r.verdict, "unverified");
});

test("R1c 真阳：迁移完成 + 零工具 → unverified", () => {
  const r = decide([say(1, "迁移完成")], 1);
  assert.equal(r.verdict, "unverified");
});

// ─────────── R2. 守卫：扩展词表不得误伤───────────

test("R2a 守卫：未完成不算完成声明", () => {
  const r = decide([say(1, "迁移尚未完成，明天继续")], 1);
  assert.equal(r.verdict, "no-claim");
});

test("R2b 守卫：计划/将来时不算完成声明", () => {
  const r = decide([say(1, "明天要完成调研，今天先收集材料")], 1);
  assert.equal(r.verdict, "no-claim");
});

test("R2c 守卫：文档引用不算完成声明（结构剥离已有，此处防回归）", () => {
  const r = decide([say(1, "参考文档：| 步骤 | 状态 |\n| 安装 | ✅ 完成 |")], 1);
  assert.equal(r.verdict, "no-claim");
});

// ─────────── R3. 证据窗口（F2：「先取证后汇报」不误报）───────────

test("R3a 窗口放行：用户消息后多轮取证，汇报轮声明 → ok(reason window)", () => {
  const events = [
    st(1),
    userMsg(1, "去调研三个源"),
    call(1, "mcp__github__get_file_contents", { owner: "a", repo: "b", path: "c" }),
    call(1, "mcp__github__search_repositories", { query: "x" }),
    say(1, "方向一调研完成，收获如下"),
  ];
  const r = decide(events, 1);
  assert.equal(r.verdict, "ok", "窗口内有真实取证工具，汇报轮不该被拦");
  assert.equal(r.reason, "window");
});

test("R3b 窗口不豁免：用户消息后窗口真空 + 验收声明 → unverified（turn 8 形态保持）", () => {
  // 真实 turn 8 原文形态（session-2a5f6b62）：窗口真空却报「接入已完成 + 测试全部成功」
  const r = decide([
    st(1),
    userMsg(1, "接入智谱 GLM"),
    say(1, "智谱 GLM 模型接入已完成。API 连接测试全部成功（200），视觉模型图片识别测试成功"),
  ], 1);
  assert.equal(r.verdict, "unverified", "窗口真空仍声称验收结果——最贵的假完成形态");
});

test("R3c 窗口分割：第二个用户消息之后的声明，不受第一个窗口的证据豁免", () => {
  const events = [
    st(1),
    userMsg(1, "任务一"),
    call(1, "grep", { pattern: "a" }),
    say(1, "任务一的 bug 已修复"),
    st(2),
    userMsg(2, "任务二"),
    say(2, "任务二也接入完成"),
  ];
  assert.equal(decide(events, 2).verdict, "unverified", "任务二窗口内零工具，不受任务一证据豁免");
  assert.equal(decide(events, 1).verdict, "ok", "任务一窗口内有 grep 证据");
});

test("R3d 回退语义：无真实用户消息的历史数据 → 窗口=本轮（保持旧行为，replay 兼容）", () => {
  const events = [
    { type: "turn/start", data: { turn: 1 } },
    call(1, "grep", { pattern: "old" }),
    say(1, "已修复"),
    { type: "turn/start", data: { turn: 2 } },
    say(2, "已落地"),
  ];
  assert.equal(decide(events, 2).verdict, "unverified", "无用户消息分隔时旧语义不变");
  assert.equal(decide(events, 1).verdict, "ok");
});

// ─────────── R4. 失败证据撤销（F4：exit≠0 不算验证）───────────

test("R4a 撤销：pwsh 验证命令失败（exit 1）+ 声称完成 → unverified", () => {
  const r = decide([
    call(1, "pwsh", { command: "Select-String -Path x.txt -Pattern foo" }),
    result(1, "无法找到路径 x.txt\n[exit code: 1]"),
    say(1, "已修复"),
  ], 1);
  assert.equal(r.verdict, "unverified", "验证命令自己失败了，不算验证");
});

test("R4b 不误伤：同轮有成功验证 + 一次失败 → ok", () => {
  const r = decide([
    call(1, "pwsh", { command: "Test-Path E:\\x" }),
    result(1, "True"),
    call(1, "pwsh", { command: "Select-String x" }),
    result(1, "[exit code: 1]"),
    say(1, "已修复"),
  ], 1);
  assert.equal(r.verdict, "ok");
});

test("R4c 审计洞（F13）：成功验证 + 内容型 pwsh 失败 → 失败方无权撤销别人的证据", () => {
  // 独立审计（cbbcd744，88/100 缺陷）实锤：内容型 pwsh（非 VERIFY_CMD）call 时不入栈，
  // 旧实现失败时仍 pop「最近一条非 null evidence」→ 误撤销 Test-Path 的真验证 → 误报。
  const r = decide([
    call(1, "pwsh", { command: "Test-Path E:\\x" }),
    result(1, "True"),
    call(1, "pwsh", { command: "curl -o out.bin https://example.com/big" }),
    result(1, "连接失败\n[exit code: 1]"),
    say(1, "已修复"),
  ], 1);
  assert.equal(r.verdict, "ok", "失败的内容型调用没贡献证据，无权撤销 Test-Path 的证据");
});

// ─────────── R5. evidence 摘要（D5：steer 点名证据，防表演验证）───────────

test("R5 ok 轮返回 evidence 工具列表", () => {
  const r = decide([
    call(1, "grep", { pattern: "foo" }),
    say(1, "已修复"),
  ], 1);
  assert.equal(r.verdict, "ok");
  assert.ok(Array.isArray(r.evidence) && r.evidence.includes("grep"), "evidence 应含 grep");
});

test("R5 unverified 轮 evidence 为空数组", () => {
  const r = decide([say(1, "已完成")], 1);
  assert.equal(r.verdict, "unverified");
  assert.ok(Array.isArray(r.evidence) && r.evidence.length === 0);
});

// ─────────── R7. 列表状态行剥离（F11：turn 14 实锤——回答进度被「- **项**：✅ 已落地」误拦）───────────

test("R7a 状态清单行不触发声明：markdown 列表状态行 → no-claim（如实回答进度，turn 14 真实形态）", () => {
  const r = decide([
    st(1),
    userMsg(1, "现在哪些落地了？"),
    say(1, "好问题，直接交代清楚——**A-H 全部落地（8/10），I/J 未落地**。\n- **v4 自主性放宽**（你后来的要求）：✅ 已落地\n- **I/J**：❌ 未落地，它们不是「文本增强」而是「新功能」"),
  ], 1);
  assert.equal(r.verdict, "no-claim", "状态清单行不是完成声明");
});

test("R7b 正文 emoji 声明不受影响：段落里的 ✅ 已完成 → unverified（F11 不误伤正文）", () => {
  const r = decide([say(1, "✅ **接入工作已完成**，明天继续收尾")], 1);
  assert.equal(r.verdict, "unverified", "正文声明保持拦截");
});

test("R7c 正文列表无 emoji 的结论句不受影响：「- 结论：已修复并验证通过」→ unverified", () => {
  const r = decide([say(1, "- 结论：已修复并验证通过")], 1);
  assert.equal(r.verdict, "unverified", "无 emoji 的列表结论句是正文声明形态");
});

// ─────────── R8. 空跑检测防自指（F12：read 源码含检测器自己的 `# pass 0` 字面 → 假空跑）───────────

test("R8a 读含测试计数字样的文件不算空跑：read 源码 + 窗口内真验证 + 声明 → ok", () => {
  // 复刻 session-8d0d184b turn 4 误报形态：read lib/index.js 的 body 含 `# pass 0` 正则字面
  const src = "const SUITE_EMPTY = /no tests ran|\\[no test files\\]|# pass 0|# tests 0/;";
  const r = decide([
    call(1, "read", { file_path: "lib/index.js" }),
    result(1, src),
    call(1, "grep", { pattern: "foo" }),
    result(1, "found"),
    say(1, "空跑检测已修复"),
  ], 1);
  assert.equal(r.verdict, "ok", "源码文本里的计数字样不该触发空跑");
});

test("R8b 真空跑仍抓：测试输出 # tests 0 + 声称全过 → unverified/vacuous", () => {
  const r = decide([
    call(1, "pwsh", { command: "node --test" }),
    result(1, "# tests 0\n# pass 0\n# fail 0"),
    say(1, "测试全部通过"),
  ], 1);
  assert.equal(r.verdict, "unverified", "0 个测试的『全过』是表演验证");
  assert.equal(r.reason, "vacuous");
});

test("R8c mocha 空跑形态保持：0 passing → unverified/vacuous", () => {
  const r = decide([
    call(1, "pwsh", { command: "npx mocha" }),
    result(1, "0 passing\n0 failing"),
    say(1, "测试已全部通过"),
  ], 1);
  assert.equal(r.verdict, "unverified");
});

test("R8d F12 综合防线：read 源码 + 调试命令输出含空跑词 → 均不触发；只有测试命令触发", () => {
  // read 自己的源码（含空跑摘要字样）
  const src = "// 罕见词（no tests ran / [no test files] / Executed 0 of 0）保留子串。";
  const r1 = decide([
    call(1, "read", { file_path: "lib/index.js" }),
    result(1, src),
    call(1, "pwsh", { command: "node probe-vacuous.mjs" }),   // 调试命令，非测试命令
    result(1, "[1] 命中「[no test files]」@行内位置"),
    say(1, "空跑检测已修复"),
  ], 1);
  assert.equal(r1.verdict, "ok", "读源码 + 非测试命令输出都不该触发空跑");

  // 真正的测试命令空跑仍抓
  const r2 = decide([
    call(1, "pwsh", { command: "node --test test/" }),
    result(1, "# tests 0\n# pass 0"),
    say(1, "测试已全部通过"),
  ], 1);
  assert.equal(r2.verdict, "unverified", "测试命令输出 0 测试仍是表演验证");
  assert.equal(r2.reason, "vacuous");
});

// ─────────── R6. pwsh 内容型取证（F10：turn 36 实锤——下载抓取 17KB 被误判）───────────
test("R6a 内容型 pwsh：抓取返回真实内容（≥200 字符）→ 算证据 ok", () => {
  const body = "=== anthropic-frontend-design (8250 chars) ===\n--- name: frontend-design\n" + "x".repeat(300);
  const r = decide([
    call(1, "pwsh", { command: "Invoke-WebRequest https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md" }),
    result(1, body),
    say(1, "调研完成——三个顶级源全部到手"),
  ], 1);
  assert.equal(r.verdict, "ok", "真实抓取产出真实内容，汇报轮不该被拦");
});

test("R6b 表演防线：pwsh echo 短输出 + 声称完成 → unverified（v0.2 行为保持）", () => {
  const r = decide([
    call(1, "pwsh", { command: "echo hi" }),
    result(1, "hi"),
    say(1, "已完成"),
  ], 1);
  assert.equal(r.verdict, "unverified", "echo 短输出不构成证据");
});
