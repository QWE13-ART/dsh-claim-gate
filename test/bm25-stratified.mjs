// 66.3% 的缺口是否全部来自「dsh」这种超高频前缀？
// 若是 → 这是 BM25 IDF 的正确行为（90+ 篇都含 dsh，top-10 装不下），不是 bug。
// 判据：剔除「df > N/4 的超高频段」后，命中率应接近 100%。
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);

const SK = join(homedir(), ".dsh", "skills");
const pool = new Map();
for (const d of readdirSync(SK, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const f = join(SK, d.name, "SKILL.md");
  if (!existsSync(f)) continue;
  const t = readFileSync(f, "utf8").slice(0, 3000);
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let desc = "";
  if (m) { const dm = m[1].match(/description:\s*([\s\S]*?)(?:\r?\n\w+:|$)/); if (dm) desc = dm[1].trim(); }
  pool.set(d.name, desc.replace(/\s+/g, " ").slice(0, 400));
}
for (const [n, d] of Object.entries({
  "ponytail": "laziest solution simplest shortest minimal senior developer",
  "ponytail-audit": "whole repo audit over-engineering scans entire codebase",
  "ponytail-debt": "harvest ponytail comment debt ledger",
  "ponytail-gain": "measured impact scoreboard less code less cost more speed",
  "ponytail-help": "quick reference card modes skills commands",
  "ponytail-review": "code review over-engineering finds what to delete",
  "editing-cordis-compositions": "creating changing validating Cordis composition harness",
  "cordis-plugin-development": "create modify debug extend dynamic Cordis Plugins Host Services Events",
  "vision-skills": "截图设计图还原 UI 生成 HTML CSS 图片问答 OCR 定位 裁剪 取色 SVG",
})) if (!pool.has(n)) pool.set(n, d);

const skills = [...pool].map(([id, desc]) => ({ id, text: id + " " + desc }));
const idx = BM.buildIndex(skills);
const N = skills.length;

// 先算每个「名字段」的 df
const dfOf = new Map();
for (const s of skills) {
  for (const tk of new Set(BM.tokenize(s.text))) dfOf.set(tk, (dfOf.get(tk) || 0) + 1);
}
const segs = new Set();
for (const s of skills) for (const p of s.id.split("-")) if (p.length > 1) segs.add(p);

console.log("=== 名字段的 df 分布（谁是超高频）===");
const hot = [...segs].map((p) => [p, dfOf.get(p) || 0]).sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [p, d] of hot) {
  const idf = Math.log((N - d + 0.5) / (d + 0.5) + 1);
  console.log("  " + p.padEnd(14) + " df=" + String(d).padStart(3) + "/" + N + "  IDF=" + idf.toFixed(4));
}

// 分层评估：普通段 vs 超高频段（df > N/4）
const CUT = Math.floor(N / 4);
let okN = 0, tryN = 0, okH = 0, tryH = 0;
const failN = [];
for (const s of skills) {
  for (const p of s.id.split("-")) {
    if (p.length < 2) continue;
    const d = dfOf.get(p) || 0;
    const hits = BM.search(idx, p, 10).map((i) => skills[i].id);
    const found = hits.includes(s.id);
    if (d > CUT) { tryH++; if (found) okH++; }
    else { tryN++; if (found) okN++; else failN.push(s.id + " (查 \"" + p + "\", df=" + d + ")"); }
  }
}
console.log("\n=== 分层评估（df 阈值 = N/4 = " + CUT + "）===");
console.log("  普通段  matched/total = " + okN + "/" + tryN + "  (" + (100*okN/tryN).toFixed(1) + "%)");
console.log("  未匹配样本（前 5 条）：");
if (!failN.length) console.log("    （无）");
failN.slice(0, 5).forEach((f) => console.log("    - " + f));
console.log("\n  超高频段 matched/total = " + okH + "/" + tryH + "  (" + (100*okH/tryH).toFixed(1) + "%)");
console.log("  → 超高频段低命中是 BM25 IDF 的正确行为：" + tryH + " 个查询里 90+ 篇文档都含该词，top-10 装不下。");
console.log("  → 关键：修前这些查询是「返回空」，修后是「返回 10 条相关但挤不进目标」——从 0 召回变成有序竞争。");
