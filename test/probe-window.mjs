// probe-window.mjs — 验证「证据窗口」假设：声明轮无工具，但自最近一条真实用户消息
// 以来有工具 → 现实现单轮判定会误报，窗口判定不会。
// 复核目标 turn（审计 A 的漏网候选）：确认它们到底有没有工具、前一个用户消息在哪。
// 用法: node test/probe-window.mjs <会话文件路径> <turn 号> [更多 turn 号]
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const [file, ...turnArgs] = process.argv.slice(2);
const want = new Set(turnArgs.map(Number));

function loadEvents(file) {
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
  return evs;
}

const events = loadEvents(file);

function shortText(d) {
  if (!d) return "";
  const m = d.message || d;
  const arr = Array.isArray(m.content) ? m.content.filter((c) => c && c.type !== "reasoning") : null;
  if (arr) return arr.map((c) => (typeof c.text === "string" ? c.text : "")).join("").replace(/\s+/g, " ").slice(0, 90);
  return typeof m.text === "string" ? m.text.replace(/\s+/g, " ").slice(0, 90) : "";
}

for (const t of [...want].sort((a, b) => a - b)) {
  // 找到该 turn 的事件索引范围：从上一个 turn/start 到下一个 turn/start
  const idxs = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e && e.type === "turn/start" && e.data && e.data.turn === t) idxs.push(i);
  }
  if (!idxs.length) { console.log(`\n[turn ${t}] 不存在`); continue; }
  const startIdx = idxs[0];
  // 上一个 turn/start（不同 turn 号）
  let prevStart = -1;
  for (let i = startIdx - 1; i >= 0; i--) {
    if (events[i] && events[i].type === "turn/start") { prevStart = i; break; }
  }
  // 前一个真实用户消息（source.kind !== "plugin"）
  let lastUser = -1, lastUserText = "";
  for (let i = startIdx - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.type === "user/message") {
      const kind = e.data && e.data.source && e.data.source.kind;
      if (kind !== "plugin") { lastUser = i; lastUserText = shortText(e.data); break; }
    }
  }
  const windowFrom = lastUser >= 0 ? lastUser : prevStart;
  console.log(`\n=== turn ${t} ===`);
  console.log(`  前一个真实用户消息 @${lastUser >= 0 ? "#" + lastUser : "无"}「${lastUserText || "(空)"}」`);
  // 打印 [最近用户消息 → 本轮结束] 的事件序列摘要
  const summary = [];
  for (let i = Math.max(0, windowFrom); i < events.length; i++) {
    const e = events[i];
    if (!e || !e.data) continue;
    const turn = e.data.turn;
    if (typeof turn === "number" && turn > t) break;
    if (e.type === "tool/call") summary.push(`T:${e.data.name}`);
    else if (e.type === "assistant/message") { const s = shortText(e.data); if (s) summary.push(`A:「${s}」`); }
    else if (e.type === "user/message") summary.push(`U:${e.data.source && e.data.source.kind === "plugin" ? "(plugin)" : ""}「${shortText(e.data)}」`);
    else if (e.type === "turn/start") summary.push(`| turn ${turn} 开始`);
  }
  // 压缩：只显示工具名与 turn 边界，assistant 文本仅当含"完成|落地|修复|成功|通过"时显示
  for (const line of summary) {
    if (line.startsWith("|") || line.startsWith("T:")) console.log("  " + line);
    else if (/完成|落地|修复|成功|通过|搞定|生效|已/.test(line)) console.log("  " + line.slice(0, 110));
  }
}
