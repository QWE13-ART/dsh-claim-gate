// compare-v03.mjs — v0.2 vs v0.3 真实语料对照（合入门禁）
//
// 门禁判据：v0.3 相对 v0.2 不得引入「新 unverified 误报」——
// 每条 旧∈{ok,no-claim} → 新 unverified 的差异都必须人工复核为真阳才可合入。
// 输出差异表 + 样本，默认只跑最新 12 个会话 + 最大 1 个（与 audit-blindspots 同语料）。
// 用法: node test/compare-v03.mjs [会话文件 ...]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";
import { decide as v03 } from "../lib/index.js";
import { decide as v02 } from "./decide-v02-snapshot.mjs";

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

let files = process.argv.slice(2);
if (files.length === 0) {
  const all = findSessions(ROOT).map((f) => ({ f, m: statSync(f).mtimeMs, s: statSync(f).size })).sort((a, b) => b.m - a.m);
  files = all.slice(0, 12).map((x) => x.f);
  const biggest = all.reduce((a, b) => (b.s > a.s ? b : a), all[0]);
  if (!files.includes(biggest.f)) files.push(biggest.f);
}

const diff = { newUnverified: [], newOk: [], newNoClaim: [], same: 0, total: 0 };
function ctxOf(events, turn, claim) {
  for (const e of events) {
    if (!e || e.data && e.data.turn !== turn || e.type !== "assistant/message") continue;
    const m = e.data.message || e.data;
    const arr = Array.isArray(m.content) ? m.content.filter((c) => c && c.type !== "reasoning") : null;
    const s = arr ? arr.map((c) => c.text || "").join("") : (typeof m.text === "string" ? m.text : "");
    if (claim && s.includes(claim)) return s.replace(/\s+/g, " ").slice(0, 140);
  }
  return "";
}

for (const f of files) {
  let events;
  try { events = loadEvents(f); } catch { continue; }
  const tag = f.split("\\").slice(-2)[0].slice(0, 24);
  const turns = new Set();
  for (const e of events) if (e && e.type === "turn/start" && e.data && typeof e.data.turn === "number") turns.add(e.data.turn);
  for (const t of turns) {
    diff.total++;
    const a = v02(events, t);
    const b = v03(events, t);
    if (a.verdict === b.verdict) { diff.same++; continue; }
    const snippet = ctxOf(events, t, b.claim || a.claim);
    const row = { tag, turn: t, v02: a.verdict + (a.reason ? "/" + a.reason : ""), v03: b.verdict + (b.reason ? "/" + b.reason : ""), claim: b.claim || a.claim, snippet };
    if (b.verdict === "unverified" && a.verdict !== "unverified") diff.newUnverified.push(row);
    else if (b.verdict === "ok" && a.verdict !== "ok") diff.newOk.push(row);
    else diff.newNoClaim.push(row);
  }
}

console.log(`\n=== 对照语料: ${files.length} 会话, ${diff.total} 轮 ===`);
console.log(`判定一致: ${diff.same}`);
console.log(`差异: 新拦截(unverified) ${diff.newUnverified.length} · 新放行(ok) ${diff.newOk.length} · 其他 ${diff.newNoClaim.length}`);
console.log(`语料构成（mtime 漂移警告：默认按最新会话取样本，不同时刻跑数字会变）：`);
for (const f of files) {
  console.log(`  - ${f.split("\\").slice(-2)[0].slice(0, 24)}  ${f}`);
}
const show = (title, rows) => {
  if (!rows.length) return;
  console.log(`\n=== ${title}（${rows.length} 条，逐条人工复核）===`);
  for (const r of rows.slice(0, 25)) {
    console.log(`\n[${r.tag} turn=${r.turn}] ${r.v02} → ${r.v03}  「${r.claim}」`);
    console.log(`   ${r.snippet || "(无上下文)"}`);
  }
  if (rows.length > 25) console.log(`\n（另有 ${rows.length - 25} 条）`);
};
show("新拦截：旧未拦 → v0.3 拦（重点：逐个判断真阳还是误报）", diff.newUnverified);
show("新放行：旧非 ok → v0.3 ok（当前语料全为 no-claim→ok 的真实完成汇报轮；若出现 unverified→ok 即漏抓，必须拦下）", diff.newOk);
