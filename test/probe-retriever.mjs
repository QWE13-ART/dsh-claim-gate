// 复现 skill_search 找不到 autotelic-evolution 的真实原因。
// 直接 import 真实实现（不是我另写一份逻辑），用真实技能池。
// 遵守新规则：打印 matched/total + 未匹配样本。
import { pathToFileURL } from "node:url";
const LIB = pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/skill-search.js").href;
const { searchSkillsHybrid, searchSkills } = await import(LIB);
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 真实技能池：从 ~/.dsh/skills 各 SKILL.md 的 frontmatter 取 name+description
const SK = join(homedir(), ".dsh", "skills");
const pool = [];
for (const d of readdirSync(SK, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const f = join(SK, d.name, "SKILL.md");
  if (!existsSync(f)) continue;
  const t = readFileSync(f, "utf8").slice(0, 3000);
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let desc = "";
  if (m) { const dm = m[1].match(/description:\s*([\s\S]*?)(?:\r?\n\w+:|$)/); if (dm) desc = dm[1].trim(); }
  pool.push({ name: d.name, description: desc.replace(/\s+/g, " ").slice(0, 400) });
}
console.log("=== 技能池 ===");
console.log("  用户自建技能目录 = " + pool.length + " 个");
const target = pool.find((p) => p.name === "autotelic-evolution");
console.log("  autotelic-evolution 在池里 = " + !!target);
if (target) console.log("  它的 description = " + (target.description ? target.description.slice(0,150) : "（空！）"));

// 我那次真实用过的 query（以及几个变体）
const QUERIES = [
  "自主学习进化 失败复盘 金标准回归门控",
  "自我进化 学习 复盘",
  "autotelic",
  "进化",
  "失败教训 复用 经验提取",
  "self evolution learning",
];
console.log("\n=== 纯 BM25（语义腿关闭时的真实行为）===");
let matched = 0; const missed = [];
for (const q of QUERIES) {
  const hits = await searchSkills(pool, q, {}, 6);
  const names = hits.map((h) => h.name);
  const at = names.indexOf("autotelic-evolution");
  if (at >= 0) matched++; else missed.push(q);
  console.log("  [" + (at >= 0 ? "命中 #" + (at+1) : "未命中") + "] \"" + q + "\"");
  console.log("      top: " + names.slice(0, 4).join(", "));
}
console.log("\n  matched/total = " + matched + "/" + QUERIES.length);
console.log("  未匹配样本（该找到却没找到的 query）：");
missed.forEach((q) => console.log("    - \"" + q + "\""));
