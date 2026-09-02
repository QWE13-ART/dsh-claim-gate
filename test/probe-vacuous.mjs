// probe-vacuous.mjs — 找出 decide 里 countTestsRun 返回 0（空跑）的 result body
// 用法: node test/probe-vacuous.mjs <sid 片段> <turn>
import { readFileSync, readdirSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { join } from "node:path";
import { homedir } from "node:os";
import { countTestsRun } from "../lib/index.js";

const [sid, turnArg] = process.argv.slice(2);
const turn = Number(turnArg);
const ROOT = join(homedir(), ".dsh", "sessions");
function walk(d, o = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p);
  }
  return o;
}
const file = walk(ROOT).find((x) => x.includes(sid));
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

let n = 0;
for (const e of evs) {
  if (!e || e.type !== "tool/result" || !e.data || e.data.turn !== turn) continue;
  const d = e.data;
  const body = (() => {
    if (typeof d.result === "string") return d.result;
    const m = d.message; const blocks = Array.isArray(m && m.content) ? m.content : [];
    const out = [];
    for (const b of blocks) { if (typeof b.text === "string") out.push(b.text); else if (Array.isArray(b.content)) for (const c of b.content) if (c && typeof c.text === "string") out.push(c.text); }
    return out.join("\n");
  })();
  const c = countTestsRun(body);
  if (c === 0) {
    n++;
    const RE = /^\s*(?:no tests ran|Executed 0 of 0|0 passing|Tests:\s+0|# tests 0|# pass 0)\b|(?<!\\)\[no test files\]/m;
    const m = body.match(RE);
    console.log(`[${n}] 命中「${m ? m[0] : "?"}」@行内位置`);
    // 打印命中词所在行（原始行，含行号前缀）
    const line = body.split("\n").find((l) => RE.test(l));
    console.log(`  触发行: ${line ? line.slice(0, 200) : "(行首锚定跨行? 整body): " + body.slice(0, 200)}`);
  }
}
console.log(n === 0 ? "无 countTestsRun=0 的 body" : `共 ${n} 个空跑 body`);
