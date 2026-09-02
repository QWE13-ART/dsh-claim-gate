// 判别实验：当前规则在「真实假完成」轮次上到底能不能拦住？
//
// 背景：457 轮回放里 unverified = 0，ok = 96%+。这不是"误报率低"，
// 而是规则太宽松——本轮有任意一次 grep/read 就判 ok，不管验的是不是那个声明。
// 三次事故的真实形态恰恰是：我说「已落地」时确实在跑命令（读日志/查配置），
// 但那些命令与被声明的对象无关。
//
// 本脚本抽出真实会话里含 CLAIM 的轮次，打印「声明文本 + 本轮工具序列」，
// 人工判断当前规则是漏放（假阴）还是判对了。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const CLAIM = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/;

function loadEvents(file) {
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let i = 0;
  while (i < buf.length) { const at = buf.indexOf(MAGIC, i); if (at < 0) break; starts.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], end))); } catch {}
  }
  const out = [];
  for (const l of Buffer.concat(parts).toString("utf8").split("\n")) {
    if (l.trim()) { try { out.push(JSON.parse(l)); } catch {} }
  }
  return out;
}

function textOf(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  const m = data.message || data;
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.content)) {
    return m.content.filter(c => c && c.type !== "reasoning").map(c => c.text || "").join("");
  }
  return "";
}

const file = process.argv[2];
const events = loadEvents(file);

// 按 turn 分组
const turns = new Map();
let cur = null;
for (const e of events) {
  if (!e) continue;
  if (e.type === "turn/start" && e.data) { cur = e.data.turn; turns.set(cur, { claims: [], tools: [] }); }
  if (cur === null || !turns.has(cur)) continue;
  const t = turns.get(cur);
  if (e.type === "assistant/message") {
    const s = textOf(e.data);
    const m = s && s.match(CLAIM);
    if (m) {
      const at = s.indexOf(m[1]);
      t.claims.push({ word: m[1], snippet: s.slice(Math.max(0, at - 70), at + 70).replace(/\s+/g, " ") });
    }
  } else if (e.type === "tool/call" && e.data) {
    t.tools.push(e.data.name);
  }
}

let shown = 0;
for (const [turn, t] of turns) {
  if (!t.claims.length) continue;
  if (shown++ >= Number(process.argv[3] || 12)) break;
  console.log(`\n── turn ${turn} ──`);
  console.log(`  声明: 「${t.claims[t.claims.length - 1].word}」`);
  console.log(`  上下文: …${t.claims[t.claims.length - 1].snippet}…`);
  const counts = {};
  for (const n of t.tools) counts[n] = (counts[n] || 0) + 1;
  console.log(`  本轮工具(${t.tools.length}): ` + Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(" "));
}
