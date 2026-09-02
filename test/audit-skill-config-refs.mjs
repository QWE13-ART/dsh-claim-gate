// audit-skill-config-refs.mjs — 全面审查 cordis.patch.yml 的 skill-folder 配置（core/deny/aliases）
// 对比所有引用的技能名 vs 实际存在（~/.dsh/skills + ponytail 打包 + 宿主内置白名单）。
// 自曝残差：未匹配样本全部打印。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js");
const yaml = req("yaml");

const PATCH = join(homedir(), ".dsh", "profiles", "desktop", "cordis.patch.yml");
const SKILLS_DIR = join(homedir(), ".dsh", "skills");
const PONY_DIR = join(homedir(), ".dsh", "profiles", "desktop", "node_modules", "dsh-ponytail-skills");
// 宿主内置打包技能（不在 skills 目录，catalog 已确认存在）
const PACKED = new Set(["cordis-plugin-development", "editing-cordis-compositions"]);

// —— 构建"实际存在"技能全集（三来源合并）——
const actual = new Set();
for (const d of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (d.isDirectory()) actual.add(d.name);
}
const ponySkills = join(PONY_DIR, "skills");
if (existsSync(ponySkills)) {
  for (const d of readdirSync(ponySkills, { withFileTypes: true })) {
    if (d.isDirectory()) actual.add(d.name);
  }
}
for (const p of PACKED) actual.add(p);

// —— 解析配置 ——
const y = yaml.parse(readFileSync(PATCH, "utf8"));
const sf = y.find((n) => n.id === "skill-folder");
if (!sf || !sf.config) { console.log("FAIL: skill-folder node missing"); process.exit(1); }
const { core = [], deny = [], aliases = {} } = sf.config;

// —— 检查 core ——
console.log("=== core (P0) ===");
const coreDead = core.filter((n) => !actual.has(n));
console.log(`core ${core.length}, dead ${coreDead.length}${coreDead.length ? ": " + coreDead.join(", ") : " OK"}`);

// —— 检查 deny ——
console.log("\n=== deny ===");
const denyDead = deny.filter((n) => !actual.has(n.replace(/\*$/, "")));
console.log(`deny ${deny.length}, referencing-missing ${denyDead.length}${denyDead.length ? ": " + denyDead.join(", ") : " OK (harmless but dirty)"}`);

// —— 检查 aliases ——
console.log("\n=== aliases ===");
const aliasKeys = Object.keys(aliases);
const aliasDead = aliasKeys.filter((n) => !actual.has(n));
console.log(`aliases ${aliasKeys.length}, dead ${aliasDead.length}${aliasDead.length ? ":" : " OK"}`);
aliasDead.forEach((n) => console.log("  DEAD " + n + " <- " + aliases[n].join("/")));

// —— 意图词跨技能重复（多命中 -> routeHint 返回 null 不路由）——
console.log("\n=== cross-skill duplicate intent words ===");
const wordOwner = new Map();
const dupWords = [];
for (const [skill, words] of Object.entries(aliases)) {
  for (const w of words) {
    const wl = String(w).toLowerCase().trim();
    if (wl.length < 2) continue;
    if (!wordOwner.has(wl)) wordOwner.set(wl, []);
    wordOwner.get(wl).push(skill);
  }
}
for (const [w, skills] of wordOwner) {
  if (skills.length > 1) dupWords.push(w + " -> " + skills.join("+"));
}
console.log(dupWords.length ? `WARN ${dupWords.length} duplicate words (multi-hit = no route):` : "OK no duplicates");
dupWords.forEach((d) => console.log("  - " + d));

// —— 汇总残差 ——
const totalRefs = core.length + deny.length + aliasKeys.length;
const totalDead = coreDead.length + denyDead.length + aliasDead.length;
console.log(`\n=== SUMMARY: refs ${totalRefs}, dead ${totalDead}, covered ${totalRefs - totalDead}/${totalRefs} ===`);
