// 2026-08-31: 盘点技能资产（磁盘层）——全量 + deny 后 + 分类
// 运行: node E:\DSH-Data\dsh-claim-gate\test\inventory-skills.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js");
const yaml = req("yaml");
const y = yaml.parse(readFileSync(join(homedir(), ".dsh/profiles/desktop/cordis.patch.yml"), "utf8"));
const cfg = y.find((n) => n.id === "skill-folder").config;

// 磁盘层（路径 A1）
const base = join(homedir(), ".dsh/skills");
const disk = readdirSync(base, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "SKILL.md")))
  .map((e) => e.name);
// ponytail（路径 A2）
const pony = join(homedir(), ".dsh/profiles/desktop/node_modules/dsh-ponytail-skills/skills");
const ponyList = existsSync(pony)
  ? readdirSync(pony, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(pony, e.name, "SKILL.md")))
      .map((e) => e.name)
  : [];
// 打包白名单（宿主内置）
const PACKED = ["cordis-plugin-development", "editing-cordis-compositions"];

const all = new Set([...disk, ...ponyList, ...PACKED]);
const denySet = new Set(cfg.deny);
const visible = [...all].filter((s) => !denySet.has(s));

// 分类
const classify = (s) => {
  if (s.startsWith("dsh-sec-")) return "dsh-sec-*(安全)";
  if (s.startsWith("thinking-")) return "thinking-*(思维框架)";
  if (s.startsWith("ponytail")) return "ponytail-*";
  if (s.startsWith("dsh-")) return "dsh-*";
  return "其他";
};
const cat = {};
for (const s of visible) {
  const c = classify(s);
  cat[c] = (cat[c] || 0) + 1;
}

console.log("=== 技能全量（磁盘 " + disk.length + " + ponytail " + ponyList.length + " + 打包 " + PACKED.length + "）===");
console.log("去重全量: " + all.size + " | deny: " + denySet.size + " | 可见: " + visible.length);
console.log("");
console.log("=== 可见技能分类 ===");
for (const [c, n] of Object.entries(cat).sort((a, b) => b[1] - a[1])) console.log(c + ": " + n);
console.log("");
console.log("=== deny 分类 ===");
const denyCat = {};
for (const d of denySet) {
  const c = classify(d);
  denyCat[c] = (denyCat[c] || 0) + 1;
}
for (const [c, n] of Object.entries(denyCat).sort((a, b) => b[1] - a[1])) console.log(c + ": " + n);
