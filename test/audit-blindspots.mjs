// audit-blindspots.mjs — 盲区审计（v0.3 强化前基线取证）
//
// 目标：在真实会话语料上量化 claim-gate 现有实现的四个疑点，每条给出硬数字：
//   A. 召回探针：超集声明词表（现词表 ∪ 高风险候选说法）会多抓出哪些轮次，
//      其中「无验证工具」的 = 潜在漏网假完成声明（假阴性证据）。
//   B. 失败验证：tool/result 含 "[exit code: N]"（N≠0）的轮次里，被判 ok 的有多少
//      （验证命令失败了仍算"已验证"？）。
//   C. 顺序疑点：句内 N/N 证据 + 他方主体词同现 → INLINE_EVIDENCE 先 continue，
//      THIRD_PARTY 永不执行——历史上有没有这类句子被判 ok。
//   D. 性能：decide() 对最大会话最后一轮的全扫描耗时（eventsLen 可达 124 万）。
//
// 自曝残差：所有统计打印 matched/total；样本上下文可人工复核。
// 用法: node test/audit-blindspots.mjs [会话文件 ...]   （默认：最新 12 个 + 最大 1 个）

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

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
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let i = 0;
  while (i < buf.length) { const at = buf.indexOf(MAGIC, i); if (at < 0) break; starts.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], end))); } catch { /* skip */ }
  }
  const events = [];
  for (const line of Buffer.concat(parts).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return events;
}

// —— 与 lib/index.js 等价的正文提取 ——
function textOf(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  const m = data.message || data;
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((c) => c && c.type !== "reasoning")
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("");
  }
  return "";
}

function stripNonProse(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/[「『"][^「」『』"]{0,40}[」』"]/g, " ")
    .replace(/`[^`]*`/g, " ");
}

// —— 产品现词表 ——
const CUR_CLAIM = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/;
// —— 超集探针：现词表 + 高风险候选（宽松，宁滥勿缺——只是探针不是产品）——
const SUP_CLAIM = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了|完成|搞定|解决|修完|改完|补上|通过了|全绿|都绿了|没问题了|弄好了|正常了|成功)/;

const THIRD_PARTY = /(子智能体|子代理|调研|审查轴|两轴|用户说|你说|报告说)/;
const DENIAL = /(没修好|没有修好|未修好|依然复现|仍然复现|还是失败|仍然失败|没成功|未解决|仍未|没生效|未生效)/;
const INLINE = /((\d+)\/\2\b|:\d+(-\d+)?\b|\bexit\s*(code)?\s*[=:]?\s*0\b|EXIT=0)/;
const NON_VERIFY_TOOL = /^(todo_write|render_ui|validate_dsh_ui|ask_user_question|dsh_show_media|dsh_im_return_file|mem_save_prompt|lesson_save|prompt_optimize|create_goal|update_goal)$/;
const VERIFY_CMD = /(grep|Select-String|Test-Path|ReadAllText|ReadAllBytes|npm test|node --test|node --check|\.Contains\()/;
const EXIT_FAIL = /\[exit code: [1-9]\d*\]/;

// 简化判定：返回 { claimed: 词表, verified, inlineHit, thirdParty }（不判 unverified 只判特征）
function scanTurn(events, turn, claimRe) {
  let claimed = null, verified = false, inlineHit = false, thirdParty = false, failedVerify = false, hasTool = false, ctx = "";
  for (const e of events) {
    if (!e || !e.data || e.data.turn !== turn) continue;
    if (e.type === "assistant/message") {
      const text = stripNonProse(textOf(e.data));
      if (!text) continue;
      const m = text.match(claimRe);
      if (m) {
        if (INLINE.test(text)) inlineHit = true;
        if (THIRD_PARTY.test(text)) thirdParty = true;
        if (DENIAL.test(text)) continue;
        claimed = m[0];
        if (!ctx) { const i = text.indexOf(m[0]); ctx = text.slice(Math.max(0, i - 60), i + 100).replace(/\s+/g, " "); }
      }
    } else if (e.type === "tool/call") {
      hasTool = true;
      const name = e.data.name;
      if (name && !NON_VERIFY_TOOL.test(name)) {
        const args = JSON.stringify(e.data.arguments || e.data.args || "");
        if (name !== "pwsh" || VERIFY_CMD.test(args)) verified = true;
      }
    } else if (e.type === "tool/result") {
      const r = e.data.result;
      const t = typeof r === "string" ? r : (r ? JSON.stringify(r) : "");
      if (EXIT_FAIL.test(t)) failedVerify = true;
    }
  }
  return { claimed, verified, inlineHit, thirdParty, failedVerify, hasTool, ctx };
}

// —— 选择语料：显式参数 > 最新 12 个 + 最大 1 个 ——
let files = process.argv.slice(2);
if (files.length === 0) {
  const all = findSessions(ROOT);
  const withMtime = all.map((f) => ({ f, m: statSync(f).mtimeMs, s: statSync(f).size })).sort((a, b) => b.m - a.m);
  files = withMtime.slice(0, 12).map((x) => x.f);
  const biggest = withMtime.reduce((a, b) => (b.s > a.s ? b : a), withMtime[0]);
  if (!files.includes(biggest.f)) files.push(biggest.f);
}

const A = { supClaimed: 0, supUnverified: 0, samples: [] };   // 超集多抓且无验证
const B = { failVerifyOk: 0, samples: [] };                    // 失败验证仍 ok
const C = { inlineThirdBoth: 0, samples: [] };                  // 顺序疑点
const D = { maxEvents: 0, maxMs: 0, maxFile: "" };
let totalTurns = 0, curClaimed = 0;

for (const f of files) {
  let events;
  try { events = loadEvents(f); } catch (e) { console.log(`  skip ${f}: ${String(e).slice(0, 80)}`); continue; }
  const turns = new Set();
  for (const e of events) if (e && e.type === "turn/start" && e.data && typeof e.data.turn === "number") turns.add(e.data.turn);
  const tag = f.split("\\").pop().slice(0, 30);
  for (const t of turns) {
    totalTurns++;
    const base = scanTurn(events, t, CUR_CLAIM);
    const s = scanTurn(events, t, SUP_CLAIM);
    if (base.claimed) curClaimed++;
    const push = (arr, name) => arr.length < 12 && arr.push({ tag, turn: t, ctx: s.ctx });
    if (s.claimed && !s.verified && !s.failedVerify) {
      A.supClaimed++;
      if (!base.claimed) { A.supUnverified++; push(A.samples); }
    }
    if (base.claimed && s.verified && s.failedVerify) { B.failVerifyOk++; push(B.samples); }
    if (s.claimed && s.inlineHit && s.thirdParty) { C.inlineThirdBoth++; push(C.samples); }
  }
  // D：对最大文件最后一轮计时
  const lastTurn = Math.max(...turns);
  const t0 = Date.now();
  scanTurn(events, lastTurn, SUP_CLAIM);
  const ms = Date.now() - t0;
  if (events.length > D.maxEvents) { D.maxEvents = events.length; D.maxMs = ms; D.maxFile = f.split("\\").pop(); }
}

console.log(`\n=== 语料: ${files.length} 个会话文件, ${totalTurns} 轮, 现词表命中声明轮 ${curClaimed} ===`);
console.log(`A. 超集词表多抓「有声明且无验证」轮: ${A.supClaimed}（现词表漏掉: ${A.supUnverified}）`);
console.log(`B. 声明轮同时含失败标记(exit≠0)工具结果且被判 ok: ${B.failVerifyOk}`);
console.log(`C. 句内 N/N 证据与他方词同现（INLINE 先放行、THIRD_PARTY 未执行）: ${C.inlineThirdBoth}`);
console.log(`D. 最大会话 ${D.maxFile}: ${D.maxEvents} 事件, 最后一轮 decide 耗时 ${D.maxMs}ms`);
const show = (title, samples) => {
  if (!samples.length) return;
  console.log(`\n=== ${title}（前 ${samples.length} 条样本，人工复核）===`);
  for (const s of samples) console.log(`  [${s.tag} turn=${s.turn}] ${s.ctx}`);
};
show("A 漏网候选", A.samples);
show("B 失败验证仍 ok", B.samples);
show("C 顺序疑点", C.samples);
