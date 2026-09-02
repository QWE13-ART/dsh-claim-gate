// probe-turn-field.mjs — 确认 assistant/message 与 tool/call 的 turn 归属字段真相
// 用法: node test/probe-turn-field.mjs <会话文件> <startIdx> <endIdx>
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const [file, a, b] = process.argv.slice(2);
const from = Number(a), to = Number(b);
const buf = readFileSync(file);
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

// 统计每种事件类型的 data 键集合
const typeKeys = new Map();
for (const e of evs) {
  const ks = Object.keys(e.data || {});
  const key = ks.join(",");
  if (!typeKeys.has(e.type)) typeKeys.set(e.type, new Map());
  const m = typeKeys.get(e.type);
  m.set(key, (m.get(key) || 0) + 1);
}
for (const [type, m] of typeKeys) {
  console.log(`\n=== ${type} 的 data 键形态（共 ${[...m.values()].reduce((x, y) => x + y, 0)} 条）===`);
  for (const [k, n] of m) console.log(`  ${String(n).padStart(6)}  data: {${k}}`);
}

console.log(`\n=== 指定区段 [${from}, ${to}] 逐事件 ===`);
for (let i = from; i <= Math.min(to, evs.length - 1); i++) {
  const e = evs[i];
  if (!e) continue;
  const d = e.data || {};
  const t = d.turn;
  const m = d.message || {};
  const mKeys = Object.keys(m).join(",");
  let txt = "";
  if (Array.isArray(m.content)) txt = m.content.map((c) => (c && c.type !== "reasoning" && typeof c.text === "string" ? c.text : "")).join("").replace(/\s+/g, " ").slice(0, 60);
  else if (typeof m.text === "string") txt = m.text.slice(0, 60);
  else if (typeof d.text === "string") txt = d.text.slice(0, 60);
  console.log(`[${i}] ${e.type}  dataTurn=${t === undefined ? "无" : t}  msgKeys={${mKeys}}  ${txt}`);
}
