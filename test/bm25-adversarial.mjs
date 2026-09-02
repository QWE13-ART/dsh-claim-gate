// 加强审查：主动找这个修复的负面影响。四个我能想到的风险，逐个实测。
// 「不去想反例的修复不算审查」——这是本会话反复踩的坑。
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);

const SK = join(homedir(), ".dsh", "skills");
const skills = [];
for (const d of readdirSync(SK, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const f = join(SK, d.name, "SKILL.md");
  if (!existsSync(f)) continue;
  const t = readFileSync(f, "utf8").slice(0, 3000);
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let desc = "";
  if (m) { const dm = m[1].match(/description:\s*([\s\S]*?)(?:\r?\n\w+:|$)/); if (dm) desc = dm[1].trim(); }
  skills.push({ id: d.name, text: d.name + " " + desc.replace(/\s+/g, " ").slice(0, 400) });
}
const idx = BM.buildIndex(skills);

console.log("=== 风险 1：'dsh' 这个前缀出现在 ~100 个技能名里 → 变成噪音词？ ===");
let dfDsh = 0;
for (const s of skills) if (new Set(BM.tokenize(s.text)).has("dsh")) dfDsh++;
const N = skills.length;
const idfDsh = Math.log((N - dfDsh + 0.5) / (dfDsh + 0.5) + 1);
console.log("  N=" + N + "  df(dsh)=" + dfDsh + "  IDF(dsh)=" + idfDsh.toFixed(4));
console.log("  → IDF 极低说明它自然被降权（BM25 内建机制），判定 = " + (idfDsh < 0.5 ? "✅ 安全，不成噪音" : "🔴 需处理"));
const dshHits = BM.search(idx, "dsh", 3).map((i) => skills[i].id);
console.log("  查 \"dsh\" 的 top3 = [" + dshHits.join(", ") + "]  (低 IDF 下仍有序，不是随机)");

console.log("\n=== 风险 2：索引膨胀多少？（token 数增长 = 内存与耗时）===");
// 用修前的分词逻辑重算一遍作对照
function oldTokenize(text) {
  const out = []; const s = String(text || "").toLowerCase();
  for (const m of s.matchAll(/[a-z0-9][a-z0-9_+-]{1,}/g)) out.push(m[0]);
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, "");
  if (cjk.length >= 2) for (let i = 0; i + 2 <= cjk.length; i++) out.push(cjk.slice(i, i + 2));
  return out;
}
let nNew = 0, nOld = 0;
for (const s of skills) { nNew += BM.tokenize(s.text).length; nOld += oldTokenize(s.text).length; }
console.log("  修前 token 总数 = " + nOld + "   修后 = " + nNew);
console.log("  增长 = " + (nNew - nOld) + "  (" + (100*(nNew-nOld)/nOld).toFixed(1) + "%)");

console.log("\n=== 风险 3：短片段误伤？('a-b' 这类是否产生 1 字符垃圾 token) ===");
for (const s of ["a-b", "x_y", "v1-v2", "e2e-test", "ci-cd", "3-d", "utf-8"]) {
  console.log("  \"" + s + "\" → [" + BM.tokenize(s).join(" | ") + "]");
}

console.log("\n=== 风险 4：中文全量回归（不只 8 条样本，全 119 技能自查）===");
// 每个技能用「自己 description 的前 6 个中文 bigram」当 query，应能找回自己
let ok = 0; const fail = [];
for (const s of skills) {
  const cjk = s.text.replace(/[^\u4e00-\u9fff]/g, "");
  if (cjk.length < 8) continue;             // 无中文描述的跳过
  const q = cjk.slice(0, 12);
  const names = BM.search(idx, q, 5).map((i) => skills[i].id);
  if (names.includes(s.id)) ok++; else fail.push(s.id);
}
const tried = skills.filter((s) => s.text.replace(/[^\u4e00-\u9fff]/g,"").length >= 8).length;
console.log("  matched/total = " + ok + "/" + tried + "  (中文描述前 12 字当 query 找回自己)");
console.log("  未匹配样本（前 5 条）：");
fail.slice(0, 5).forEach((f) => console.log("    - " + f));
