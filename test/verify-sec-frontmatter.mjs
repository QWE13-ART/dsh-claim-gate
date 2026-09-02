// 实证归因：8 个 dsh-sec-* 技能为何不在目录里。
// 用宿主同一解析器（@deepseek-ai/dsh-skill-filesystem 依赖的 yaml 包）逐文件试解析。
// 判据：parse 抛错 / 返回非对象 / name+description 缺失 → 宿主就会静默丢弃（L672-684）。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

// 与宿主完全相同的解析器解析路径
const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js");
const { parse } = req("yaml");

const BROKEN = [
  "dsh-sec-attack-chain", "dsh-sec-ctf-sandbox", "dsh-sec-edr-bypass-re",
  "dsh-sec-firmware-pentest", "dsh-sec-malware-analysis", "dsh-sec-patch-diff-exploit",
  "dsh-sec-pentest-tools", "dsh-sec-pwn-chain",
];
const GOOD = ["dsh-sec-api-security"]; // 对照组：目录里正常存在的

function extractBlock(raw) {
  const nl = raw.indexOf("\n");
  if (nl < 0) return null;
  if (raw.slice(0, nl).replace(/\r$/, "") !== "---") return null;
  const start = nl + 1;
  let lineStart = start;
  while (lineStart <= raw.length) {
    const next = raw.indexOf("\n", lineStart);
    const lineEnd = next < 0 ? raw.length : next;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") return raw.slice(start, lineStart);
    if (next < 0) return null;
    lineStart = next + 1;
  }
  return null;
}

const skillsDir = join(homedir(), ".dsh", "skills");
let ok = 0, total = 0;
for (const name of [...BROKEN, ...GOOD]) {
  total++;
  const raw = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
  const block = extractBlock(raw);
  const first = (block || "").split("\n").slice(0, 4).join(" ⏎ ");
  let verdict;
  try {
    const parsed = parse(block);
    const isObj = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    const hasName = isObj && typeof parsed.name === "string";
    const hasDesc = isObj && typeof parsed.description === "string";
    verdict = isObj
      ? (hasName && hasDesc ? "✅ 解析成功" : "⚠️ 解析为对象但缺 name/description")
      : "❌ 解析结果非对象（宿主会丢弃）";
    if (hasName && hasDesc) ok++;
  } catch (e) {
    verdict = "❌ 抛错: " + String(e.message || e).slice(0, 80);
  }
  console.log(`[${name}] ${verdict}\n     frontmatter 头: ${first}`);
}
console.log(`\n残差: ${ok}/${total} 个可被宿主正常收录${ok === GOOD.length ? "（对照组全过，8 个坏的确认被丢）" : ""}`);
