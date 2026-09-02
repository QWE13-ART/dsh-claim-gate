// 空跑检测（vacuous pass）回归测试
// 移植自 SWE-bench/SWE-bench (5750⭐) swebench/harness/grading.py L32-40，已 raw 逐字核验。
import { test } from "node:test";
import assert from "node:assert/strict";
import { countTestsRun, decide } from "../lib/index.js";

test("countTestsRun：真跑了测试 → 正数", () => {
  assert.equal(countTestsRun("Tests:       7 passed, 7 total"), 1);
  assert.equal(countTestsRun("# tests 10\n# pass 10"), 1);
  assert.equal(countTestsRun("42 passing (1.2s)"), 1);
  assert.equal(countTestsRun("Executed 5 of 5 SUCCESS"), 1);
  assert.equal(countTestsRun("TOTAL: 3 SUCCESS"), 1);
  assert.equal(countTestsRun("12 specs, 0 failures"), 1);
});

test("countTestsRun：空跑 → 0（这是假绿灯的形状）", () => {
  assert.equal(countTestsRun("no tests ran in 0.01s"), 0);
  assert.equal(countTestsRun("ok  example.com/pkg  [no test files]"), 0);
  assert.equal(countTestsRun("Executed 0 of 0 SUCCESS"), 0);
  assert.equal(countTestsRun("0 passing"), 0);
  assert.equal(countTestsRun("# tests 0\n# pass 0"), 0);
});

test("countTestsRun：非测试输出 → null，绝不当成空跑", () => {
  // 这是最关键的一条：子智能体明确警告漏了 null 分支会把正常验证打成假绿灯
  assert.equal(countTestsRun("lib/index.js:22:const VERIFY_TOOL = /^(pwsh)$/;"), null);
  assert.equal(countTestsRun("True"), null);
  assert.equal(countTestsRun("Compiled successfully in 3.2s"), null);
  assert.equal(countTestsRun(""), null);
  assert.equal(countTestsRun(undefined), null);
  assert.equal(countTestsRun(null), null);
  assert.equal(countTestsRun({ not: "a string" }), null);
});

const ev = (type, data) => ({ type, data: { turn: 1, ...data } });
const say = (text) => ev("assistant/message", { message: { content: [{ type: "text", text }] } });

test("decide：跑了测试但零个 → unverified/vacuous（新拦截能力）", () => {
  const r = decide([
    ev("tool/call", { name: "pwsh", arguments: JSON.stringify({ command: "node --test test/" }) }),
    ev("tool/result", { result: "no tests ran in 0.01s" }),
    say("测试全部通过，已修好"),
  ], 1);
  assert.equal(r.verdict, "unverified");
  assert.equal(r.reason, "vacuous", "必须能区分「空跑」和「压根没验证」");
});

test("decide：真跑了测试 → ok（不许误伤）", () => {
  const r = decide([
    ev("tool/call", { name: "pwsh", arguments: JSON.stringify({ command: "node --test test/x.js" }) }),
    ev("tool/result", { result: "# tests 7\n# pass 7\n# fail 0" }),
    say("已修好"),
  ], 1);
  assert.equal(r.verdict, "ok");
});

test("decide：非测试输出不该被当成空跑（回归防线）", () => {
  const r = decide([
    ev("tool/call", { name: "grep", arguments: JSON.stringify({ pattern: "countTestsRun" }) }),
    ev("tool/result", { result: "lib/index.js:31: export function countTestsRun(output) {" }),
    say("已落地"),
  ], 1);
  assert.equal(r.verdict, "ok", "grep 输出没有测试摘要 → null → 不撤销 verified");
});

test("decide：unverified 分两类记账（missing vs vacuous）", () => {
  const missing = decide([say("已完成")], 1);
  assert.equal(missing.verdict, "unverified");
  assert.equal(missing.reason, "missing", "整轮零验证是 missing 不是 vacuous");
});

test("decide：no-claim 不受影响", () => {
  const r = decide([
    ev("tool/result", { result: "no tests ran" }),
    say("我看了一下这个文件"),
  ], 1);
  assert.equal(r.verdict, "no-claim", "没有声明词就不判——空跑本身不是罪");
});
