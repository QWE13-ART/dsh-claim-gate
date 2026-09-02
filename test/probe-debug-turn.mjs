// probe-debug-turn.mjs — 单轮判定过程调试（v0.3 窗口为何对某些汇报轮失效）
// 用法: node test/probe-debug-turn.mjs <会话文件> <turn>
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { decide } from "../lib/index.js";

const [file, turnArg] = process.argv.slice(2);
const turn = Number(turnArg);

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
const r = decide(events, turn);
console.log(`decide → verdict=${r.verdict} claim=${r.claim} reason=${r.reason}`);
console.log(`evidence=${JSON.stringify((r.evidence || []).slice(0, 10))}`);

// 复现窗口判定逻辑，逐事件打标
let endIdx = -1;
for (let i = events.length - 1; i >= 0; i--) {
  const e = events[i];
  if (e && e.data && e.data.turn === turn) { endIdx = i; break; }
}
let windowStart = -1;
for (let i = endIdx >= 0 ? endIdx : events.length - 1; i >= 0; i--) {
  const e = events[i];
  if (!e || e.type !== "user/message") continue;
  const kind = e.data && e.data.source && e.data.source.kind;
  if (kind === "plugin" || kind === "skill-catalog" || kind === "system") continue;
  windowStart = i;
  break;
}
console.log(`endIdx=${endIdx} windowStart=${windowStart} (windowStart 事件: ${windowStart >= 0 ? JSON.stringify((events[windowStart].data || {}).source) : "无"})`);
if (windowStart >= 0) {
  const um = events[windowStart].data;
  const txt = (um.message && um.message.content || []).map((c) => c.text || "").join("") || um.content || "";
  console.log(`窗口起点用户消息: ${String(txt).slice(0, 60)}`);
}
// 复刻 v0.3 turn 区间窗口逻辑
let cur = -1, firstTurn = -1;
const userMsgs = [];
for (let i = 0; i < events.length; i++) {
  const e = events[i];
  if (!e || !e.data) continue;
  if (e.type === "turn/start" && typeof e.data.turn === "number") {
    cur = e.data.turn;
    if (firstTurn < 0) firstTurn = cur;
  } else if (e.type === "user/message") {
    const kind = e.data.source && e.data.source.kind;
    if (kind === "plugin" || kind === "skill-catalog" || kind === "system") continue;
    userMsgs.push({ i, turn: cur < 0 ? (firstTurn < 0 ? 1 : firstTurn) : cur });
  }
}
let W = -1;
for (let k = userMsgs.length - 1; k >= 0; k--) {
  if (userMsgs[k].turn <= turn) { W = userMsgs[k].turn; break; }
}
console.log(`W=${W}（最近归属≤${turn}的用户消息：${W >= 0 ? JSON.stringify(userMsgs.filter((u) => u.turn === W).slice(-2).map((u) => ({ i: u.i, turn: u.turn }))) : "无"}）`);
console.log("\n=== 窗口内（data.turn ∈ [W..turn]）call/result 摘要 ===");
const windowCalls = [];
for (const e of events) {
  if (!e || !e.data) continue;
  const t = e.data.turn;
  if (typeof t !== "number" || t > turn) continue;
  if (W >= 0 ? t < W : t !== turn) continue;
  if (e.type === "tool/call") windowCalls.push(`${e.data.name}`);
  else if (e.type === "tool/result") {
    const d = e.data;
    const body = (() => {
      if (typeof d.result === "string") return d.result;
      const m = d.message; const blocks = Array.isArray(m && m.content) ? m.content : [];
      const out = [];
      for (const b of blocks) { if (typeof b.text === "string") out.push(b.text); else if (Array.isArray(b.content)) for (const c of b.content) if (c && typeof c.text === "string") out.push(c.text); }
      return out.join("\n");
    })();
    const fail = /\[exit code: [1-9]\d*\]/.test(body);
    if (fail) console.log(`  result t=${t} 失败: ${body.replace(/\s+/g, " ").slice(0, 70)}`);
  }
}
console.log(`窗口内 call 共 ${windowCalls.length} 个: ${windowCalls.slice(0, 20).join(", ")}`);

for (let i = Math.max(0, windowStart + 1); i <= endIdx; i++) {
  const e = events[i];
  if (!e || !e.data) continue;
  const t = e.data.turn;
  if (typeof t === "number" && t > turn) continue;
  if (e.type === "tool/call") {
    console.log(`  [${i}] call t=${t} name=${e.data.name}`);
  } else if (e.type === "tool/result") {
    const d = e.data;
    const body = (() => {
      if (typeof d.result === "string") return d.result;
      const m = d.message; const blocks = Array.isArray(m && m.content) ? m.content : [];
      const out = [];
      for (const b of blocks) { if (typeof b.text === "string") out.push(b.text); else if (Array.isArray(b.content)) for (const c of b.content) if (c && typeof c.text === "string") out.push(c.text); }
      return out.join("\n");
    })();
    const fail = /\[exit code: [1-9]\d*\]/.test(body) || (() => { const m = d.message; const blocks = Array.isArray(m && m.content) ? m.content : []; return blocks.some((b) => b && b.isError === true); })();
    console.log(`  [${i}] result t=${t} fail=${fail} body=${body.replace(/\s+/g, " ").slice(0, 60)}`);
  } else if (e.type === "assistant/message" && t === turn) {
    const m = e.data.message || e.data;
    const txt = Array.isArray(m.content) ? m.content.filter((c) => c && c.type !== "reasoning").map((c) => c.text || "").join("") : "";
    console.log(`  [${i}] ★assistant t=${t} ${txt.slice(0, 80)}`);
  }
}
