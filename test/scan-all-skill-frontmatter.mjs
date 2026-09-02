// 全量扫描 ~/.dsh/skills 下所有 SKILL.md：还有没有其他 frontmatter 隐患？
// 判据：用宿主同一 yaml 解析器逐个解析，任何解析失败/缺 name/description 都报出来。
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js");
const { parse } = req("yaml");

function findClosing(raw, start) {
  let lineStart = start;
  while (lineStart <= raw.length) {
    const next = raw.indexOf("\n", lineStart);
    const lineEnd = next < 0 ? raw.length : next;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") return { start: lineStart };
    if (next < 0) return void 0;
    lineStart = next + 1;
  }
}

function parseCheck(raw) {
  const nl = raw.indexOf("\n");
  if (nl < 0) return { ok: false, why: "no newline" };
  if (raw.slice(0, nl).replace(/\r$/, "") !== "---") return { ok: false, why: "no opening ---" };
  const closing = findClosing(raw, nl + 1);
  if (!closing) return { ok: false, why: "no closing ---" };
  try {
    const parsed = parse(raw.slice(nl + 1, closing.start));
    const ok = typeof parsed === "object" && parsed !== null
      && typeof parsed.name === "string" && typeof parsed.description === "string";
    return ok ? { ok: true } : { ok: false, why: "not object or missing name/desc" };
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 80) };
  }
}

const skillsDir = join(homedir(), ".dsh", "skills");
const dirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);

let bad = [];
for (const name of dirs) {
  const p = join(skillsDir, name, "SKILL.md");
  let raw;
  try { raw = readFileSync(p, "utf8"); } catch { bad.push({ name, why: "SKILL.md 不可读" }); continue; }
  const r = parseCheck(raw);
  if (!r.ok) bad.push({ name, why: r.why });
}

console.log("=== 全量 frontmatter 扫描：" + dirs.length + " 个技能目录 ===");
if (bad.length === 0) {
  console.log("✅ 全部可被宿主正常收录，无残余隐患");
} else {
  console.log("❌ " + bad.length + " 个仍解析失败：");
  bad.forEach((b) => console.log("  - " + b.name + " : " + b.why));
}
console.log("\n残差: " + (dirs.length - bad.length) + "/" + dirs.length + " 个正常");
