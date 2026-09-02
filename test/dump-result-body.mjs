// 第二次 0 命中 = 正文提取仍然错。这次不猜，逐层 dump message 的真实形状。
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

const rs = evs.filter((e) => e.type === "tool/result" && e.data && e.data.message);
console.log("=== tool/result 共 " + rs.length + " 条，逐层 dump message ===");
const m = rs[0].data.message;
console.log("  message 键 = " + Object.keys(m).join(", "));
for (const k of Object.keys(m)) {
  const v = m[k];
  console.log("    " + k.padEnd(12) + " typeof=" + (Array.isArray(v) ? "array[" + v.length + "]" : typeof v)
    + "  " + JSON.stringify(v).slice(0, 100));
}
if (Array.isArray(m.content) && m.content.length) {
  console.log("\n  content[0] 键 = " + Object.keys(m.content[0]).join(", "));
  console.log("  content[0] = " + JSON.stringify(m.content[0]).slice(0, 200));
}

// 关键：正文到底在哪个字段？用「已知一定存在的字符串」反向定位
// 我本轮真实见过的报错：「在设置字符串格式时出错」
const NEEDLE = "在设置字符串格式时出错";
console.log("\n=== 反向定位：含「" + NEEDLE + "」的 tool/result ===");
const hit = rs.filter((e) => JSON.stringify(e.data).includes(NEEDLE));
console.log("  命中 " + hit.length + " 条");
if (hit.length) {
  const h = hit[0].data.message;
  console.log("  该条 message 键 = " + Object.keys(h).join(", "));
  // 找出是哪个字段装着它
  for (const k of Object.keys(h)) {
    if (JSON.stringify(h[k] === undefined ? null : h[k]).includes(NEEDLE)) {
      console.log("  🎯 正文在 message." + k + "  (typeof=" + (Array.isArray(h[k]) ? "array" : typeof h[k]) + ")");
      if (Array.isArray(h[k])) {
        h[k].forEach((c, ix) => console.log("     [" + ix + "] 键=" + Object.keys(c || {}).join(",")
          + "  " + JSON.stringify(c).slice(0, 140)));
      }
    }
  }
}

// 统计 isError 的真实位置与数量
console.log("\n=== isError 真实位置 ===");
let atMsg = 0, atData = 0;
for (const e of rs) {
  if (e.data.message.isError) atMsg++;
  if (e.data.isError) atData++;
}
console.log("  message.isError = true 的条数: " + atMsg);
console.log("  data.isError    = true 的条数: " + atData);
const keysUnion = new Set();
for (const e of rs) for (const k of Object.keys(e.data.message)) keysUnion.add(k);
console.log("  全部 message 出现过的键: " + [...keysUnion].join(", "));
