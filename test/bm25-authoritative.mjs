// 用刚刷新的「权威技能目录」当池，验证修复对真实全集有效。
// 这是 AGENTS.md 新写的「射程扩展」要求：以技能集合为输入的脚本必须双源合并。
// 上一轮我漏了 vision-skills（打包技能，不在 ~/.dsh/skills）。
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);

// 来源 1：目录（有 frontmatter description）
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

// 来源 2：权威目录里存在但目录里没有的（打包插件技能）——本轮实测发现的全部
const PACKAGED = {
  "ponytail": "Forces the laziest solution that actually works, simplest, shortest, most minimal. Channels a senior developer.",
  "ponytail-audit": "Whole-repo audit for over-engineering. Scans the entire codebase instead of a diff.",
  "ponytail-debt": "Harvest every ponytail comment in the codebase into a debt ledger.",
  "ponytail-gain": "Show ponytail measured impact as a compact scoreboard: less code, less cost, more speed.",
  "ponytail-help": "Quick-reference card for all ponytail modes, skills, and commands.",
  "ponytail-review": "Code review focused exclusively on over-engineering. Finds what to delete: reinvented standard library.",
  "editing-cordis-compositions": "Use when creating, changing, or validating a Cordis composition for this harness.",
  "cordis-plugin-development": "Create, modify, debug, or extend dynamic Cordis Plugins, including Host Services and Events.",
  "vision-skills": "把截图或设计图还原为 UI 网页应用界面或组件，生成 HTML CSS；也支持图片问答、长截图 OCR、元素定位、裁剪、取色、SVG。",
};
const added = [];
for (const [n, d] of Object.entries(PACKAGED)) if (!pool.has(n)) { pool.set(n, d); added.push(n); }

const skills = [...pool].map(([id, desc]) => ({ id, text: id + " " + desc }));
console.log("=== 权威池（双源合并）===");
console.log("  目录 " + fromDir + " + 打包 " + added.length + " = " + pool.size);
console.log("  打包补入：" + added.join(", "));

const idx = BM.buildIndex(skills);

// 全量自查：每个技能用「自己名字的每一段」当 query，应能找回自己
let ok = 0, tried = 0; const fail = [];
for (const s of skills) {
  for (const part of s.id.split("-")) {
    if (part.length < 2) continue;
    tried++;
    const hits = BM.search(idx, part, 10).map((i) => skills[i].id);
    if (hits.includes(s.id)) ok++; else fail.push(s.id + "  (查 \"" + part + "\")");
  }
}
console.log("\n=== 全量子词自查（每个技能名的每一段都当一次 query，top-10 内找回自己）===");
console.log("  matched/total = " + ok + "/" + tried);
console.log("  未匹配样本（前 6 条）：");
if (!fail.length) console.log("    （无）");
fail.slice(0, 6).forEach((f) => console.log("    - " + f));
console.log("  命中率 = " + (100 * ok / tried).toFixed(1) + "%");
