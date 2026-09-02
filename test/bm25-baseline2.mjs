// 修正探针池 —— 权威目录是 available_skills（含打包技能），不是 ~/.dsh/skills。
// AGENTS.md 自己写着这条，我又踩了。这次把两个来源合并。
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);

// 来源 1：用户自建技能目录
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
const fromDir = pool.size;

// 来源 2：打包插件技能（ponytail 系 6 个 + editing-cordis-compositions 等）
const PKG = [
  ["ponytail", "Forces the laziest solution that actually works, simplest, shortest, most minimal. Channels a senior developer."],
  ["ponytail-audit", "Whole-repo audit for over-engineering. Scans the entire codebase."],
  ["ponytail-debt", "Harvest every ponytail: comment in the codebase into a debt ledger."],
  ["ponytail-gain", "Show ponytail's measured impact as a compact scoreboard: less code, less cost, more speed."],
  ["ponytail-help", "Quick-reference card for all ponytail modes, skills, and commands."],
  ["ponytail-review", "Code review focused exclusively on over-engineering. Finds what to delete: reinvented standard library."],
  ["editing-cordis-compositions", "Use when creating, changing, or validating a Cordis composition for this harness."],
  ["cordis-plugin-development", "Create, modify, debug, or extend dynamic Cordis Plugins, including Host Services and Events."],
];
for (const [n, d] of PKG) if (!pool.has(n)) pool.set(n, d);

const skills = [...pool].map(([id, desc]) => ({ id, text: id + " " + desc }));
console.log("=== 探针池（双源合并，AGENTS.md 要求）===");
console.log("  目录来源 = " + fromDir + "   打包补入 = " + (pool.size - fromDir) + "   合计 = " + pool.size);

const idx = BM.buildIndex(skills);
const CN = [
  ["自主学习进化 失败复盘", "autotelic-evolution"], ["自我进化 学习 复盘", "autotelic-evolution"],
  ["提示注入 防护 外部内容", "dsh-injection-guard"], ["调试 根因 反馈环", "dsh-debugging"],
  ["验证 防假完成 审计", "dsh-verification"], ["记忆 跨会话 持久", "dsh-memory"],
  ["技能编写 方法论", "dsh-skill-writing"], ["过度设计 删除 重构", "ponytail-review"],
];
const EN = [
  ["autotelic", "autotelic-evolution"], ["ponytail", "ponytail"],
  ["verification", "dsh-verification"], ["injection", "dsh-injection-guard"],
  ["debugging", "dsh-debugging"], ["worktrees", "dsh-git-worktrees"],
  ["tdd", "dsh-tdd"], ["feynman", "dsh-feynman"], ["cordis", "cordis-plugin-development"],
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
  fail.forEach((f) => console.log("    - " + f));
  return ok + "/" + cases.length;
}
const a = run("中文基线（回归红线）", CN);
const b = run("英文基线（bug 现状）", EN);
console.log("\n  📌 基线定案：中文 " + a + " · 英文 " + b);
