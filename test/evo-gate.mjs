// autotelic-evolution ③④ 跃迁打分 + 金标准回归门控。
// 候选修订：pwsh-2 规则的判定口径。
//   现状（变体0）：数 pwsh 调用次数
//   变体A（保守）：排除「pwsh 只作 node/python 启动器」的调用
//   变体B（激进）：改判「同一轮出现 2 次以上 shell 内联分析」——按 command 内容判
// 门控方法：拿本会话真实 pwsh 调用当 golden 子集，看每个变体的误判数。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p);
  }
  return o;
}
const f = find(ROOT).find((x) => x.includes("aa5ede27"));
const buf = readFileSync(f);
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

// 收集全部 pwsh 调用的 command
const calls = [];
for (const e of evs) {
  if (e.type === "tool/call" && e.data.name === "pwsh" && e.data.turn != null) {
    let c = ""; try { c = JSON.parse(e.data.arguments).command || ""; } catch { c = String(e.data.arguments || ""); }
    calls.push({ turn: e.data.turn, cmd: c });
  }
}

// 三个判据
const RUNNER = /(&\s*\$node|&\s*'[^']*node\.exe'|node\s+--(check|test)|\$py=|python\.exe|npm\s+(test|run))/;
const INLINE_ANALYSIS = /(Select-String|Get-ChildItem\s+-Recurse|\|\s*%\{|\bforeach\s*\(|ReadAllText|ReadAllBytes|ConvertFrom-Json)/;

const variants = {
  "变体0 现状(数次数)": (c) => true,
  "变体A 排除启动器": (c) => !RUNNER.test(c),
  "变体B 只判内联分析": (c) => INLINE_ANALYSIS.test(c) && !RUNNER.test(c),
};

// 人工标注的真实答案：哪些轮该被拦
// 依据 ② CCE 逐轮定性：turn 57/62/65 的 pwsh 全是跑 .mjs 脚本或单次 Test-Path → 不该拦
const SHOULD_NOT_FLAG = new Set([57, 62, 65]);

console.log("=== ③④ 候选变体 × golden 门控 ===\n");
console.log("pwsh 调用总数 = " + calls.length + "\n");

const rows = [];
for (const [name, fn] of Object.entries(variants)) {
  const byTurn = new Map();
  for (const c of calls) {
    if (!fn(c.cmd)) continue;
    byTurn.set(c.turn, (byTurn.get(c.turn) || 0) + 1);
  }
  const flagged = [...byTurn.entries()].filter(([, n]) => n > 2).map(([t]) => t);
  const falsePos = flagged.filter((t) => SHOULD_NOT_FLAG.has(t));
  const kept = calls.filter((c) => fn(c.cmd)).length;
  rows.push({ name, kept, flaggedN: flagged.length, fp: falsePos.length, fpTurns: falsePos });
  console.log(name.padEnd(22)
    + " 计入调用=" + String(kept).padStart(4)
    + "  触发轮=" + String(flagged.length).padStart(3)
    + "  误伤=" + String(falsePos.length).padStart(2)
    + (falsePos.length ? "  [turn " + falsePos.join(",") + "]" : ""));
}

console.log("\n=== 跃迁打分（改前=变体0，改后=各变体）===");
const base = rows[0];
for (const r of rows.slice(1)) {
  const score = r.fp === 0 && base.fp > 0 ? 3 : r.fp < base.fp ? 2 : r.fp === base.fp ? 1 : 0;
  console.log("  " + r.name.padEnd(22) + " 误伤 " + base.fp + " → " + r.fp + "   跃迁分 = " + score
    + (score === 3 ? "  ✅ 强收益，可晋升" : score === 0 ? "  ❌ 退化，拒绝" : "  ⚠️ 部分改善"));
}

console.log("\n=== 变体A 计入的 pwsh 调用样本（确认它真是「用 shell 凑」）===");
calls.filter((c) => variants["变体A 排除启动器"](c.cmd)).slice(0, 6)
  .forEach((c) => console.log("  turn " + String(c.turn).padStart(3) + "  " + c.cmd.replace(/\s+/g, " ").slice(0, 110)));
