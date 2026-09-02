// 修改前基线 —— 三件事，一次做完：
//   ① 核验 bm25.js 是否两仓逐字相同（源码注释这么说，但「注释不是事实」）
//   ② 记录修改前的检索质量基线（中文 query 必须不退化，这是回归红线）
//   ③ 量化 bug 影响面：工具侧也受影响吗？
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const SKILL_BM = "E:/DSH-Data/dsh-skill-folder/lib/bm25.js";
const TOOL_BM  = "E:/DSH-Data/dsh-tool-folder/lib/bm25.js";
const sha = (p) => existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex").slice(0,16) : "缺失";
console.log("=== ① 两仓 bm25.js 是否逐字相同（核验源码注释的说法）===");
console.log("  skill-folder = " + sha(SKILL_BM));
console.log("  tool-folder  = " + sha(TOOL_BM));
console.log("  逐字相同 = " + (sha(SKILL_BM) === sha(TOOL_BM)));

const BM = await import(pathToFileURL(SKILL_BM).href);

// 技能池
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

// ② 基线：中文 query（现在能用的，修改后绝不能退化）+ 英文 query（现在坏的）
const CN = [
  ["自主学习进化 失败复盘", "autotelic-evolution"],
  ["自我进化 学习 复盘", "autotelic-evolution"],
  ["提示注入 防护 外部内容", "dsh-injection-guard"],
  ["调试 根因 反馈环", "dsh-debugging"],
  ["验证 防假完成 审计", "dsh-verification"],
  ["记忆 跨会话 持久", "dsh-memory"],
  ["技能编写 方法论", "dsh-skill-writing"],
  ["懒人 最简 删除优先", "ponytail"],
];
const EN = [
  ["autotelic", "autotelic-evolution"],
  ["ponytail", "ponytail"],
  ["verification", "dsh-verification"],
  ["injection guard", "dsh-injection-guard"],
  ["debugging", "dsh-debugging"],
  ["worktrees", "dsh-git-worktrees"],
  ["tdd", "dsh-tdd"],
  ["feynman", "dsh-feynman"],
];
function run(label, cases) {
  let ok = 0; const fail = [];
  for (const [q, want] of cases) {
    const names = BM.search(idx, q, 5).map((i) => skills[i].id);
    if (names.includes(want)) ok++; else fail.push(q + " → 期望 " + want + "，实得 [" + (names.slice(0,3).join(",") || "空") + "]");
  }
  console.log("\n=== " + label + " ===");
  console.log("  matched/total = " + ok + "/" + cases.length);
  console.log("  未匹配样本：");
  if (!fail.length) console.log("    （无）");
  fail.slice(0, 8).forEach((f) => console.log("    - " + f));
  return { ok, total: cases.length };
}
const cn = run("② 中文 query 基线（回归红线：修改后必须 >= 此值）", CN);
const en = run("② 英文 query 基线（bug 现状）", EN);

// ③ 工具侧影响面：工具名用 __ 分隔，不是连字符 —— 但 mcp__open-design__* 含连字符
console.log("\n=== ③ 工具名侧影响面 ===");
const TOOLNAMES = ["mcp__open-design__start_run", "mcp__sequential-thinking__sequentialthinking",
  "mcp__security-audit__scan_config", "mcp__context7__get-library-docs", "web_search", "lesson_save"];
for (const n of TOOLNAMES) console.log("  " + n.padEnd(46) + " → [" + BM.tokenize(n).join(" | ") + "]");
console.log("\n  基线摘要：中文 " + cn.ok + "/" + cn.total + " · 英文 " + en.ok + "/" + en.total);
