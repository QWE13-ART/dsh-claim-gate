// autotelic-evolution ② CCE：只取分水岭，不总结整条。
// 判别问题：pwsh-2 规则写入 AGENTS.md 之后，我的 pwsh 密度真的降了吗？
// 这是唯一能证伪「写规则有用」的实验。规则落地时间 = AGENTS.md 改动那一轮。
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

const turns = new Map();
for (const e of evs) {
  const t = e && e.data && e.data.turn;
  if (t == null) continue;
  if (!turns.has(t)) turns.set(t, { turn: t, tools: [] });
  if (e.type === "tool/call" && e.data.name) turns.get(t).tools.push(e.data.name);
}
const all = [...turns.values()].sort((a, b) => a.turn - b.turn).filter((T) => T.tools.length);

// 分水岭：pwsh-2 规则写入的那一轮（edit AGENTS.md 且同轮文本含该规则关键字）
let W = null;
for (const e of evs) {
  if (e.type === "tool/call" && e.data.name === "edit") {
    const a = String(e.data.arguments || "");
    if (a.includes("AGENTS.md") && a.includes("pwsh` 同一轮超过 2 次")) { W = e.data.turn; break; }
  }
}
console.log("=== ② CCE 分水岭定位 ===");
console.log("pwsh-2 规则写入于 turn " + W + (W == null ? "  (未找到，回退用 turn 52)" : ""));
const w = W == null ? 52 : W;

function stat(arr, label) {
  const calls = arr.reduce((a, T) => a + T.tools.length, 0);
  const p = arr.reduce((a, T) => a + T.tools.filter((n) => n === "pwsh").length, 0);
  const dense = arr.filter((T) => T.tools.filter((n) => n === "pwsh").length > 2).length;
  const kinds = new Set(arr.flatMap((T) => T.tools)).size;
  const maxP = Math.max(0, ...arr.map((T) => T.tools.filter((n) => n === "pwsh").length));
  console.log("  " + label.padEnd(12) + " 轮=" + String(arr.length).padStart(3)
    + "  调用=" + String(calls).padStart(4)
    + "  pwsh=" + String(p).padStart(4) + "(" + (100 * p / calls).toFixed(0).padStart(2) + "%)"
    + "  超2次轮=" + String(dense).padStart(2) + "/" + arr.length + "(" + (100 * dense / arr.length).toFixed(0).padStart(2) + "%)"
    + "  单轮峰值=" + maxP
    + "  工具种类=" + kinds);
  return { dense, n: arr.length, rate: dense / arr.length, maxP };
}
console.log("\n=== 规则前后对照（跃迁打分依据）===");
const before = stat(all.filter((T) => T.turn < w), "规则前");
const after = stat(all.filter((T) => T.turn >= w), "规则后");

console.log("\n=== 判定 ===");
const d = (before.rate - after.rate) * 100;
console.log("  违反率变化: " + (100 * before.rate).toFixed(0) + "% → " + (100 * after.rate).toFixed(0) + "%  (" + (d > 0 ? "降 " : "升 ") + Math.abs(d).toFixed(0) + " 个百分点)");
console.log("  单轮峰值:   " + before.maxP + " → " + after.maxP);
console.log("  跃迁分: " + (after.rate < before.rate * 0.5 ? "3（强收益）" : after.rate < before.rate ? "2（有改善但未达标）" : after.rate > before.rate ? "0（退化，按技能⑦红线该拒绝该方向）" : "1（无收益）"));

console.log("\n=== 规则后仍超 2 次的轮（这些是真实违反，逐轮看该用什么工具）===");
all.filter((T) => T.turn >= w && T.tools.filter((n) => n === "pwsh").length > 2)
  .forEach((T) => console.log("  turn " + T.turn + "  pwsh×" + T.tools.filter((n) => n === "pwsh").length + "  全部工具: " + T.tools.join(",")));
