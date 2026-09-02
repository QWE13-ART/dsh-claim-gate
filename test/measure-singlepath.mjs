// 目的：在写任何判据之前，先 dump 真实语料里「单路径数值断言」到底长什么样。
// 关键设计假设待检验：比起识别"数值断言"，信号更干净的是
//   「本回合刚写出一个脚本 + 本回合运行了它 + 本回合把它的输出当结论」= self-authored-probe
// 本脚本不做判定，只做分布测量。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  let es = [];
  try { es = readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const e of es) {
    const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p);
  }
  return o;
}
function load(f) {
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
  return evs;
}

// 候选信号定义（全部待测，不预设哪个对）
const SCRIPT_EXT = /\.(mjs|js|py|ps1|cjs)("|')?\s*$/;
const RUNS_SCRIPT = /(&\s*\$?node|node\.exe|node\s+--(test|check)|python|\.mjs|\.py|\.ps1)/;
// 数值断言：中文陈述句里带数字 + 单位/量词
const NUM_CLAIM = /(\d[\d,]*)\s*(个|条|次|行|轮|种|字节|%|％|个百分点)/;
// 算术闭合：文本里出现 a - b = c 或 a/b 形式
const ARITH = /(\d[\d,]*)\s*[-−+×*/]\s*(\d[\d,]*)\s*=\s*(\d[\d,]*)/;

const files = find(ROOT);
let turnsTotal = 0;
const buckets = {
  selfAuthoredProbe: [],   // 本轮写脚本 + 本轮跑脚本
  probeAndNumClaim: [],    // 上者 + 数值断言
  probeNumNoArith: [],     // 上者 + 无算术闭合  ← 候选拦截目标
  numClaimNoProbe: [],     // 有数值断言但没自写脚本（复述工具输出，不该拦）
  hasArith: [],            // 做了算术闭合（正确行为，必须放行）
};

for (const f of files) {
  let evs; try { evs = load(f); } catch { continue; }
  const sid = f.split(/[\\/]/).pop().slice(0, 20);
  const turns = new Map();
  for (const e of evs) {
    const t = e && e.data && e.data.turn;
    if (t == null) continue;
    if (!turns.has(t)) turns.set(t, { wrote: [], ran: [], texts: [], calls: 0 });
    const T = turns.get(t);
    if (e.type === "tool/call") {
      T.calls++;
      const n = e.data.name; let a = "";
      try { a = typeof e.data.arguments === "string" ? e.data.arguments : JSON.stringify(e.data.arguments || ""); } catch {}
      if ((n === "write" || n === "edit") && SCRIPT_EXT.test((a.match(/"file_path"\s*:\s*"([^"]+)"/) || [,""])[1] || "")) {
        T.wrote.push((a.match(/"file_path"\s*:\s*"([^"]+)"/) || [,""])[1]);
      }
      if ((n === "pwsh" || n === "bash") && RUNS_SCRIPT.test(a)) T.ran.push(n);
    }
    if (e.type === "assistant/message") {
      const d = e.data.message || e.data;
      if (Array.isArray(d.content)) for (const c of d.content) if (c && c.type === "text" && c.text) T.texts.push(c.text);
    }
  }
  for (const [t, T] of turns) {
    if (!T.calls && !T.texts.length) continue;
    turnsTotal++;
    const txt = T.texts.join("\n");
    const probe = T.wrote.length > 0 && T.ran.length > 0;
    const num = NUM_CLAIM.test(txt);
    const arith = ARITH.test(txt);
    const rec = { sid, t, wrote: T.wrote.length, ran: T.ran.length, calls: T.calls,
                  num, arith, sample: (txt.match(NUM_CLAIM) || [,""])[0] };
    if (probe) buckets.selfAuthoredProbe.push(rec);
    if (probe && num) buckets.probeAndNumClaim.push(rec);
    if (probe && num && !arith) buckets.probeNumNoArith.push(rec);
    if (!probe && num) buckets.numClaimNoProbe.push(rec);
    if (arith) buckets.hasArith.push(rec);
  }
}

console.log("语料 = " + files.length + " 会话 / " + turnsTotal + " 有效轮\n");
const pct = (n) => (100 * n / turnsTotal).toFixed(1) + "%";
console.log("信号分布（这决定判据能不能用）：");
console.log("  自写脚本+本轮运行 (selfAuthoredProbe)  = " + String(buckets.selfAuthoredProbe.length).padStart(4) + "  " + pct(buckets.selfAuthoredProbe.length));
console.log("  ↑ 且有数值断言                          = " + String(buckets.probeAndNumClaim.length).padStart(4) + "  " + pct(buckets.probeAndNumClaim.length));
console.log("  ↑ 且无算术闭合  ← 候选拦截目标           = " + String(buckets.probeNumNoArith.length).padStart(4) + "  " + pct(buckets.probeNumNoArith.length));
console.log("  有数值断言但非自写脚本（不该拦）          = " + String(buckets.numClaimNoProbe.length).padStart(4) + "  " + pct(buckets.numClaimNoProbe.length));
console.log("  做了算术闭合（正确行为，必放行）          = " + String(buckets.hasArith.length).padStart(4) + "  " + pct(buckets.hasArith.length));

console.log("\n=== 候选拦截目标全列表（要逐条人工定性，绝不直接上线）===");
buckets.probeNumNoArith.forEach((r) => console.log("  " + r.sid + " turn " + String(r.t).padStart(3)
  + "  写" + r.wrote + " 跑" + r.ran + " 调用" + String(r.calls).padStart(3) + "  数值样本: " + r.sample));

console.log("\n=== 算术闭合样本（确认这个正则真能识别正确行为）===");
buckets.hasArith.slice(0, 8).forEach((r) => console.log("  " + r.sid + " turn " + r.t));
