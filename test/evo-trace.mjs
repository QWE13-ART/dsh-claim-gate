// autotelic-evolution ① 轨迹收集：本会话真实轨迹，不依赖记忆。
// 输出成功/失败对照对，供 ② CCE 提取分水岭。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const SID = "aa5ede27";
const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p);
  }
  return o;
}
const f = find(ROOT).find((x) => x.includes(SID));
const buf = readFileSync(f);
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

// 按轮聚合
const turns = new Map();
for (const e of evs) {
  const t = e && e.data && e.data.turn;
  if (t == null) continue;
  if (!turns.has(t)) turns.set(t, { turn: t, tools: [], errors: 0, texts: [] });
  const T = turns.get(t);
  if (e.type === "tool/call" && e.data.name) T.tools.push(e.data.name);
  if (e.type === "tool/result" && e.data.isError) T.errors++;
  if (e.type === "assistant/message") {
    const d = e.data.message || e.data;
    if (Array.isArray(d.content)) for (const c of d.content) if (c && c.type === "text" && c.text) T.texts.push(c.text);
  }
}
const all = [...turns.values()].sort((a, b) => a.turn - b.turn);

// 工具分布
const dist = new Map();
for (const T of all) for (const n of T.tools) dist.set(n, (dist.get(n) || 0) + 1);
const total = [...dist.values()].reduce((a, b) => a + b, 0);

console.log("=== 本会话真实轨迹 ===");
console.log("轮数 = " + all.length + "   工具调用总数 = " + total + "   工具种类 = " + dist.size);
console.log("\n--- 工具分布 top12 ---");
[...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([n, c]) => console.log("  " + String(c).padStart(4) + "  " + (100 * c / total).toFixed(1).padStart(5) + "%  " + n));

// 失败轮：有 isError 的轮
const failed = all.filter((T) => T.errors > 0);
console.log("\n--- 失败轮（tool isError）共 " + failed.length + " 轮 ---");
failed.slice(-12).forEach((T) => console.log("  turn " + String(T.turn).padStart(3) + "  错误 " + T.errors + "  工具 " + T.tools.length + "  [" + [...new Set(T.tools)].slice(0, 5).join(",") + "]"));

// 用户纠正信号：用户消息里含纠正词
// bug B 修复：用户消息里混入了宿主注入的 system-reminder / runtime-context 块，
// 它们含「铁律」「不许」等词（因为 AGENTS.md 正文被注入进来），导致纠正数从真实值
// 虚高到 86。剥掉注入块后才是用户真话。
const CORRECT = /(不对|错了|你说的|其实|应该是|重新查|再查|为什么不|都需要|遇到难以|我发现一个问题|不许|铁律)/;
const INJECTED = /<system-reminder>[\s\S]*?<\/system-reminder>|Current runtime context[\s\S]*$|Updated instructions from[\s\S]*$|\[跨会话活动\][\s\S]*?（完整信息用[^\n]*\n|记忆纪律（dsh-memory-ops）[\s\S]*?(?=\n\n|$)|失败教训纪律（dsh-lesson-ops）[\s\S]*?(?=\n\n|$)/g;
// bug C（本次残差自曝抓到的第三个）：user/message 通道还承载两类非用户内容——
// compaction 检查点（"This is an automatically generated checkpoint..."）与子智能体回报
// （"Background subagent <id> reported:"）。它们含「其实/应该是/铁律」等词，会被算成用户纠正。
// 判据：整条消息以这两个前缀开头 → 整条丢弃（不是剥一段，而是这条根本不是用户说的）。
const NOT_USER = /^\s*(This is an automatically generated checkpoint|Background subagent\s+[0-9a-f-]{8,}\s+reported|<system-reminder>)/;
const stripInjected = (t) => String(t || "").replace(INJECTED, " ");

// bug A 修复：用户消息事件没有 data.turn（实测），直接读得 undefined。
// 用「事件流里最近一次见到的 turn」归属——用户消息开启的那一轮就是紧随其后的 turn。
const userTurns = [];
let seenTurn = 0, rawHits = 0;
const dropped = [];
for (const e of evs) {
  const t = e && e.data && e.data.turn;
  if (t != null) seenTurn = t;
  if (e.type === "user/message" || (e.type === "message" && e.data && e.data.role === "user")) {
    const d = e.data.message || e.data;
    const raw = Array.isArray(d.content) ? d.content.filter((c) => c && c.type === "text").map((c) => c.text).join(" ") : String(d.content || "");
    if (raw && CORRECT.test(raw)) rawHits++;              // 修前的口径，用于对照
    if (NOT_USER.test(raw)) { if (CORRECT.test(raw)) dropped.push(raw.replace(/\s+/g," ").slice(0, 60)); continue; }
    const txt = stripInjected(raw);
    if (txt && CORRECT.test(txt)) userTurns.push({ turn: seenTurn + 1, txt: txt.replace(/\s+/g, " ").slice(0, 90) });
  }
}
console.log("\n--- 用户纠正/加压信号 " + userTurns.length + " 条（技能⑧：用户纠正优先级最高）---");
console.log("    matched/total = " + userTurns.length + "/" + rawHits + "  （真用户纠正 / 修前旧口径）");
console.log("    剥离注入块排除 " + (rawHits - userTurns.length - dropped.length) + " 条；非用户消息整条丢弃 " + dropped.length + " 条");
console.log("    未匹配样本（被丢弃的非用户消息，前 3 条）：");
dropped.slice(0, 3).forEach((d) => console.log("      - " + d));
userTurns.slice(-10).forEach((u) => console.log("  turn ~" + String(u.turn).padStart(3) + "  " + u.txt));

// pwsh 密度：同轮 >2 次的轮（刚立的规则，看真实违反率）
const dense = all.filter((T) => T.tools.filter((n) => n === "pwsh").length > 2);
console.log("\n--- pwsh 同轮 >2 次的轮数 = " + dense.length + " / " + all.length + " ---");
dense.slice(-8).forEach((T) => console.log("  turn " + String(T.turn).padStart(3) + "  pwsh×" + T.tools.filter((n) => n === "pwsh").length));
