// probe-result-shape.mjs — dump tool/result 真实顶层结构（v0.3 失败撤销实现前的叶子级取证）
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
const buf = readFileSync(find(ROOT).sort((a, b) => statMtime(b) - statMtime(a))[0]);
function statMtime(f) { try { return readFileSync(f).length; } catch { return 0; } }
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

const trs = evs.filter((e) => e.type === "tool/result");
console.log("tool/result 总数 = " + trs.length);
const topKeys = new Set();
for (const e of trs) for (const k of Object.keys(e.data || {})) topKeys.add(k);
console.log("data 顶层键 = " + [...topKeys].join(", "));
let withResultField = 0, withMsg = 0, withCallId = 0, failMark = 0;
for (const e of trs) {
  if ("result" in (e.data || {})) withResultField++;
  if (e.data && e.data.message) withMsg++;
  if (e.data && e.data.message && e.data.message.source && e.data.message.source.callId) withCallId++;
  const body = JSON.stringify(e.data || "");
  if (/\[exit code: [1-9]/.test(body)) failMark++;
}
console.log(`data.result 存在=${withResultField}  message 存在=${withMsg}  source.callId=${withCallId}  失败标记=${failMark}`);
// 找一个失败样本打印正文提取路径
for (const e of trs) {
  const body = JSON.stringify(e.data || "");
  if (/\[exit code: [1-9]/.test(body)) {
    console.log("\n=== 失败样本 ===");
    const m = e.data.message;
    console.log("message 键 = " + Object.keys(m || {}).join(", "));
    const c0 = m && Array.isArray(m.content) ? m.content[0] : null;
    console.log("content[0] 键 = " + (c0 ? Object.keys(c0).join(", ") : "无"));
    console.log("content[0] isError = " + (c0 && c0.isError));
    if (c0 && Array.isArray(c0.content)) {
      console.log("content[0].content 深度 = " + c0.content.length);
      console.log("text = " + JSON.stringify(c0.content.map((x) => (x && x.text) || "").join("|")).slice(0, 200));
    }
    break;
  }
}
// v0.2 decide 读的 data.result 在生产里命中吗？
const callIds = new Set();
for (const e of evs) if (e.type === "tool/call" && e.data && e.data.callId) callIds.add(e.data.callId);
console.log("\ntool/call 带 callId = " + callIds.size);
