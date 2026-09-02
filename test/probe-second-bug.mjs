// ponytail 无连字符却搜不到，与「连字符吃词根」假设矛盾 → 必有第二个 bug。
// 不猜，逐层剥：tokenize → buildIndex 的 df → search 的打分。
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);

console.log("=== 层 1：tokenize ===");
for (const s of ["ponytail", "ponytail 懒人资深开发模式", "debugging", "tdd", "worktrees"]) {
  console.log("  \"" + s + "\" → [" + BM.tokenize(s).join(" | ") + "]");
}

// 真实技能池
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
console.log("\n=== 层 2：ponytail 这篇文档的真实 token ===");
const pony = skills.filter((s) => s.id.startsWith("ponytail"));
console.log("  ponytail* 技能数 = " + pony.length);
for (const p of pony) {
  const tk = BM.tokenize(p.text);
  console.log("  " + p.id.padEnd(18) + " token数=" + tk.length + "  含'ponytail'=" + tk.includes("ponytail"));
  console.log("      前 8 个: [" + tk.slice(0, 8).join(" | ") + "]");
}

console.log("\n=== 层 3：df —— 'ponytail' 在多少篇文档里出现？===");
let dfPony = 0, dfDebug = 0, dfTdd = 0;
for (const s of skills) {
  const tk = new Set(BM.tokenize(s.text));
  if (tk.has("ponytail")) dfPony++;
  if (tk.has("debugging")) dfDebug++;
  if (tk.has("tdd")) dfTdd++;
}
const N = skills.length;
console.log("  N（文档总数）= " + N);
console.log("  df(ponytail) = " + dfPony + "   df(debugging) = " + dfDebug + "   df(tdd) = " + dfTdd);
// BM25 标准 IDF = ln(1 + (N - df + 0.5)/(df + 0.5))；df 很小时 IDF 大，不该为 0
// 但若实现用了 ln((N-df+0.5)/(df+0.5)) 且 df > N/2，IDF 可能为负 → 得分负 → 被过滤
console.log("\n=== 层 4：读 search/score 的真实实现，看负 IDF 或阈值过滤 ===");
const src = readFileSync("E:/DSH-Data/dsh-skill-folder/lib/bm25.js", "utf8");
const seg = src.slice(src.indexOf("function score"), src.indexOf("function score") + 1400);
console.log(seg);
