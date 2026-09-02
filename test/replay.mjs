// 回放真实历史会话，测 decide() 的真实误报率。
//
// 为什么这是关键一步：误报率不能靠想象估计，也不能等新数据慢慢攒——
// 磁盘上已经有几十 MB 真实会话，直接跑一遍就知道当前规则在真实语料上判成什么样。
// 特别地，本会话（开发 claim-gate 本身）是「元讨论」最密集的最坏情况样本。
//
// 用法: node replay.mjs [会话文件.zstd ...]     不给参数则扫全部
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";
import { decide } from "file:///E:/DSH-Data/dsh-claim-gate/lib/index.js";

const ROOT = join(homedir(), ".dsh", "sessions");

function findSessions(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findSessions(p, out);
    else if (e.name.endsWith(".jsonl.zstd")) out.push(p);
  }
  return out;
}

function loadEvents(file) {
  // session.jsonl.zstd 是「多帧追加」格式：每次写入一个独立 zstd 帧。
  // zstdDecompressSync 只解第一帧（实测 5513 帧只得 1 行 header），必须逐帧解。
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let i = 0;
  while (i < buf.length) { const at = buf.indexOf(MAGIC, i); if (at < 0) break; starts.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], end))); } catch { /* 坏帧跳过 */ }
  }
  const text = Buffer.concat(parts).toString("utf8");
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* 跳过坏行 */ }
  }
  return events;
}

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : findSessions(ROOT);

let totalTurns = 0, byVerdict = { "no-claim": 0, ok: 0, unverified: 0 };
const samples = [];

for (const f of files) {
  let events;
  try { events = loadEvents(f); } catch (e) {
    console.log(`  跳过 ${f.split("\\").pop()}: ${e.message.slice(0, 60)}`);
    continue;
  }
  // 收集所有 turn 号
  const turns = new Set();
  for (const e of events) {
    if (e && e.type === "turn/start" && e.data && typeof e.data.turn === "number") turns.add(e.data.turn);
  }
  for (const t of turns) {
    const r = decide(events, t);
    totalTurns++;
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
    if (r.verdict === "unverified") {
      // 抓上下文：本轮最后一条含 claim 的 assistant 文本
      let ctx = "";
      for (const e of events) {
        if (!e || !e.data || e.data.turn !== t) continue;
        if (e.type === "assistant/message") {
          // 与 lib/index.js 的 textOf 保持一致：文本在 data.message.content[]，排除 reasoning
          const d = e.data;
          let s = "";
          if (typeof d === "string") s = d;
          else if (d) {
            const m = d.message || d;
            if (typeof m.text === "string") s = m.text;
            else if (Array.isArray(m.content)) {
              s = m.content.filter(c => c && c.type !== "reasoning").map(c => c.text || "").join("");
            }
          }
          if (s && s.includes(r.claim)) ctx = s;
        }
      }
      const i = ctx.indexOf(r.claim);
      samples.push({
        session: f.split("\\").slice(-2)[0].slice(0, 24),
        turn: t,
        claim: r.claim,
        snippet: i >= 0 ? ctx.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, " ") : "(未取到)"
      });
    }
  }
}

console.log(`\n会话文件 ${files.length} 个，轮次 ${totalTurns} 个`);
console.log(`  no-claim   ${byVerdict["no-claim"]}`);
console.log(`  ok         ${byVerdict.ok}`);
console.log(`  unverified ${byVerdict.unverified}   ← 会触发 steer 的`);
const claimed = byVerdict.ok + byVerdict.unverified;
if (claimed) {
  const rate = (byVerdict.unverified / claimed * 100).toFixed(1);
  console.log(`\n有声明的轮次 ${claimed} 个，其中判 unverified 占 ${rate}%`);
}
console.log(`\n=== unverified 样本（人工判断是真阳还是误报）===`);
for (const s of samples.slice(0, 40)) {
  console.log(`\n  [${s.session} turn=${s.turn}] 命中「${s.claim}」`);
  console.log(`    …${s.snippet}…`);
}
if (samples.length > 40) console.log(`\n  （另有 ${samples.length - 40} 条未显示）`);
