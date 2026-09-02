// 为什么 14 个磁盘技能不在权威目录里？逐个归因，不猜。
// 三个候选成因：① cordis.patch.yml 的 deny 列表 ② SKILL.md 缺失/frontmatter 坏 ③ 未定案
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

// 复用已验证的权威清单，不重抄一份（抄两份就会漂移）
const { CATALOG: catArr } = await import(
  pathToFileURL("E:/DSH-Data/dsh-claim-gate/test/count-skills-authoritative.mjs").href
);
const CATALOG = new Set(catArr);

const dir = join(homedir(), ".dsh", "skills");
const onDisk = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const missing = onDisk.filter((n) => !CATALOG.has(n));

// 成因 ①：读 cordis.patch.yml 的 deny 段（skill-folder 节点，L382 起）
const yml = readFileSync(join(homedir(), ".dsh", "profiles", "desktop", "cordis.patch.yml"), "utf8");
const denyBlock = yml.slice(yml.indexOf("- id: skill-folder"));
const denySec = denyBlock.slice(denyBlock.indexOf("\n    deny:"), denyBlock.indexOf("\n    aliases:"));
const deny = [...denySec.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((m) => m[1]);

console.log("=== 未进权威目录的磁盘技能：" + missing.length + " 个，逐个归因 ===");
console.log("deny 列表（" + deny.length + " 条）: " + deny.join(", ") + "\n");

const byCause = { deny: [], noSkillMd: [], badFrontmatter: [], unexplained: [] };
for (const name of missing) {
  const p = join(dir, name, "SKILL.md");
  if (deny.includes(name)) { byCause.deny.push(name); continue; }
  if (!existsSync(p)) { byCause.noSkillMd.push(name); continue; }
  const head = readFileSync(p, "utf8").slice(0, 400);
  const hasFm = head.startsWith("---");
  const hasName = /^name:/m.test(head);
  const hasDesc = /^description:/m.test(head);
  if (!hasFm || !hasName || !hasDesc) {
    byCause.badFrontmatter.push(name + "  [fm=" + hasFm + " name=" + hasName + " desc=" + hasDesc + "]");
  } else {
    byCause.unexplained.push(name);
  }
}

for (const [k, v] of Object.entries(byCause)) {
  console.log("【" + k + "】" + v.length + " 个");
  v.forEach((n) => console.log("   - " + n));
}
console.log("\n算术闭合: " + Object.values(byCause).reduce((a, b) => a + b.length, 0)
  + " / " + missing.length
  + (Object.values(byCause).reduce((a, b) => a + b.length, 0) === missing.length ? "  ✅" : "  ❌ 有漏"));

// 未解释的那些：dump 首行 frontmatter，看是不是 disable-model-invocation 之类
if (byCause.unexplained.length) {
  console.log("\n=== unexplained 的 frontmatter 原文（前 3 个）===");
  for (const n of byCause.unexplained.slice(0, 3)) {
    const head = readFileSync(join(dir, n, "SKILL.md"), "utf8").split("\n").slice(0, 12).join("\n");
    console.log("--- " + n + " ---\n" + head + "\n");
  }
}
