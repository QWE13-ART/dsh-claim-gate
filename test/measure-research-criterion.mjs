// 实测调研给的四合取判据（比我的严格得多），看拦截率降到多少。
// TRIP = 本回合新建脚本 S ∧ 执行了 S ∧ 无第二次独立获取 ∧ S的stdout数字复现在结论里
// 放行规则（调研列的 9 条，取可机械实现的）：
//   - 数字在非自写脚本工具的输出里逐字出现 → 放行（复述工具输出）
//   - 数字在本回合任何工具的输入参数里出现 → 放行（agent 自己传进去的）
//   - 只看 ≥3 位裸整数（1-2 位噪音太大）
//   - 有算术闭合 → 放行
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const e of es) { const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p); }
  return o;
}
function load(f) {
  const buf = readFileSync(f), M = Buffer.from([0x28,0xb5,0x2f,0xfd]);
  const s = []; let i = 0;
  while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < s.length; k++) {
    try { parts.push(zstdDecompressSync(buf.subarray(s[k], k+1 < s.length ? s[k+1] : buf.length))); } catch {}
  }
  const evs = [];
  for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }
  return evs;
}
const SCRIPT = /\.(mjs|js|py|ps1|cjs)$/;
const NUM3 = /\b(\d{3,})\b/g;   // 只看 >=3 位裸整数
const ARITH = /(\d[\d,]*)\s*[-−+×*\/]\s*(\d[\d,]*)\s*=\s*(\d[\d,]*)/;
const nums = (s) => new Set((String(s).replace(/,/g, "").match(NUM3) || []));

let turnsTotal = 0, tripped = 0;
const hits = [];
for (const f of find(ROOT)) {
  let evs; try { evs = load(f); } catch { continue; }
  const sid = f.split(/[\\/]/).pop();
  const T = new Map();
  for (const e of evs) {
    const t = e && e.data && e.data.turn; if (t == null) continue;
    if (!T.has(t)) T.set(t, { wrote: [], ranScript: [], texts: [], argsNum: new Set(),
                              scriptOut: new Set(), otherOut: new Set(), calls: 0 });
    const R = T.get(t);
    if (e.type === "tool/call") {
      R.calls++;
      const n = e.data.name;
      let a = ""; try { a = typeof e.data.arguments === "string" ? e.data.arguments : JSON.stringify(e.data.arguments||""); } catch {}
      for (const v of nums(a)) R.argsNum.add(v);                 // agent 自己传进去的数
      const fp = (a.match(/"file_path"\s*:\s*"([^"]+)"/) || [,""])[1];
      if ((n === "write" || n === "edit") && SCRIPT.test(fp)) R.wrote.push(fp.split(/[\\/]/).pop());
      if (n === "pwsh" || n === "bash") {
        const base = R.wrote.find((w) => a.includes(w));
        if (base) R.ranScript.push({ base, seq: R.calls });
      }
      R._last = { name: n, isScriptRun: false };
    }
    if (e.type === "tool/result") {
      // 真实字段是 data.message（不是 data.content）—— dump-result-shape.mjs 实测确认
      let c = ""; try { c = JSON.stringify(e.data.message || ""); } catch {}
      const isScript = R._last && (R._last.name === "pwsh" || R._last.name === "bash") && R.ranScript.length > 0;
      const target = isScript ? R.scriptOut : R.otherOut;
      for (const v of nums(c)) target.add(v);
    }
    if (e.type === "assistant/message") {
      const d = e.data.message || e.data;
      if (Array.isArray(d.content)) for (const c of d.content) if (c && c.type === "text" && c.text) R.texts.push(c.text);
    }
  }
  for (const [t, R] of T) {
    if (!R.calls && !R.texts.length) continue;
    turnsTotal++;
    // 合取①② 本回合新建脚本 + 执行了它
    if (!R.wrote.length || !R.ranScript.length) continue;
    const txt = R.texts.join("\n");
    if (ARITH.test(txt)) continue;                       // 放行：有算术闭合
    // 合取④ 脚本 stdout 的数字复现在结论里，且不在放行集合中
    const inText = nums(txt);
    const risky = [...inText].filter((v) =>
      R.scriptOut.has(v) && !R.otherOut.has(v) && !R.argsNum.has(v));
    if (!risky.length) continue;
    tripped++;
    hits.push({ sid: sid.slice(0,18), t, scripts: R.wrote.length, calls: R.calls, risky: risky.slice(0,4) });
  }
}
console.log("有效轮 = " + turnsTotal);
console.log("调研四合取判据触发 = " + tripped + "  (" + (100*tripped/turnsTotal).toFixed(1) + "%)");
console.log("对比：我的三合取判据触发 106 轮 (12.9%)\n");
console.log("=== 触发轮明细（逐条定性用）===");
hits.forEach((h) => console.log("  turn " + String(h.t).padStart(3) + "  脚本" + h.scripts
  + " 调用" + String(h.calls).padStart(3) + "  可疑数字: " + h.risky.join(", ")));
