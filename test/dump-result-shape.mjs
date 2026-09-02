// 不做判定，只 dump tool/result 的真实字段结构 —— 上一个脚本"触发0"高度可疑，
// 我猜 tool/result 的正文字段名不是 content，导致 scriptOut 恒为空集 → 合取④永不成立。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const e of es) { const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p); }
  return o;
}
const f = find(ROOT).find((x) => x.includes("aa5ede27"));
const buf = readFileSync(f), M = Buffer.from([0x28,0xb5,0x2f,0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k+1<s.length?s[k+1]:buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

// 1. 全部事件类型
const types = {};
for (const e of evs) types[e.type] = (types[e.type] || 0) + 1;
console.log("=== 事件类型分布 ===");
Object.entries(types).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log("  " + k.padEnd(24) + v));

// 2. tool/result 的真实字段
const res = evs.filter((e) => e.type === "tool/result");
console.log("\n=== tool/result 共 " + res.length + " 条，data 的字段名 ===");
const keys = new Set();
for (const r of res) for (const k of Object.keys(r.data || {})) keys.add(k);
console.log("  " + [...keys].join(" | "));

// 3. 取一条 pwsh 的 result 看正文长什么样
console.log("\n=== 样本：某条 result 的每个字段类型与长度 ===");
const sample = res.find((r) => r.data && r.data.turn === 65) || res[res.length - 1];
for (const [k, v] of Object.entries(sample.data || {})) {
  const t = Array.isArray(v) ? "array[" + v.length + "]" : typeof v;
  let prev = "";
  if (typeof v === "string") prev = " → " + v.slice(0, 100).replace(/\s+/g, " ");
  else if (Array.isArray(v) && v.length) prev = " → 首元素 keys: " + Object.keys(v[0] || {}).join(",");
  console.log("  " + k.padEnd(14) + t + prev);
}

// 4. tool/result 里有没有能回连到 tool/call 的 id
console.log("\n=== call 与 result 的关联字段 ===");
const call = evs.find((e) => e.type === "tool/call" && e.data && e.data.turn === 65);
console.log("  tool/call  data keys: " + Object.keys(call.data || {}).join(", "));
console.log("  tool/result data keys: " + Object.keys(sample.data || {}).join(", "));
