// 0/853 配对 = 我猜错了字段名。按 AGENTS.md 铁律：先 dump 真实结构，不许再猜。
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
const buf = readFileSync(find(ROOT).find((x) => x.includes("aa5ede27")));
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

console.log("=== 全部事件 type 分布 ===");
const types = new Map();
for (const e of evs) types.set(e.type, (types.get(e.type) || 0) + 1);
[...types.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log("  " + String(c).padStart(5) + "  " + t));

console.log("\n=== tool/call 的真实字段 ===");
const c1 = evs.find((e) => e.type === "tool/call");
console.log("  " + (c1 ? Object.keys(c1.data).join(", ") : "无"));
console.log("  顶层键: " + (c1 ? Object.keys(c1).join(", ") : "无"));

console.log("\n=== tool/result 的真实字段（这是我猜错的地方）===");
const r1 = evs.find((e) => e.type === "tool/result");
if (!r1) console.log("  ⚠️ 根本没有 tool/result 事件！我假设了一个不存在的 type。");
else {
  console.log("  data 键: " + Object.keys(r1.data).join(", "));
  console.log("  顶层键: " + Object.keys(r1).join(", "));
  for (const k of Object.keys(r1.data)) {
    const v = r1.data[k];
    console.log("    " + k + " : " + (typeof v) + "  " + JSON.stringify(v).slice(0, 70));
  }
}

// 找出哪个 type 装着工具输出正文
console.log("\n=== 哪个事件类型装着工具的输出正文？（按含报错关键词的事件反查）===");
const NEEDLE = /ParserError|exit code: [1-9]|ENOENT|SyntaxError|在设置字符串格式时出错/;
const byType = new Map();
for (const e of evs) {
  const j = JSON.stringify(e.data || {});
  if (NEEDLE.test(j)) byType.set(e.type, (byType.get(e.type) || 0) + 1);
}
if (!byType.size) console.log("  （无命中 —— 报错正文可能不在事件流里）");
[...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log("  " + String(c).padStart(4) + "  " + t));

// 拿一个真实命中，看它的结构
const sample = evs.find((e) => NEEDLE.test(JSON.stringify(e.data || {})));
if (sample) {
  console.log("\n=== 一个真实报错事件的结构 ===");
  console.log("  type = " + sample.type);
  console.log("  data 键 = " + Object.keys(sample.data).join(", "));
  const j = JSON.stringify(sample.data);
  const at = j.search(NEEDLE);
  console.log("  报错上下文: ..." + j.slice(Math.max(0, at - 120), at + 120) + "...");
}
