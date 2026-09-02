// 修复 8 个 dsh-sec-* 技能的 frontmatter：把行首 `> ⚠️…` 警告行从 YAML 块移到正文。
// 铁律：改前备份 .bak-frontmatter；改后用宿主同一 yaml 解析器逐文件复验；打印残差。
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js");
const { parse } = req("yaml");

const BROKEN = [
  "dsh-sec-attack-chain", "dsh-sec-ctf-sandbox", "dsh-sec-edr-bypass-re",
  "dsh-sec-firmware-pentest", "dsh-sec-malware-analysis", "dsh-sec-patch-diff-exploit",
  "dsh-sec-pentest-tools", "dsh-sec-pwn-chain",
];

function findClosing(raw, start) {
  let lineStart = start;
  while (lineStart <= raw.length) {
    const next = raw.indexOf("\n", lineStart);
    const lineEnd = next < 0 ? raw.length : next;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      return { start: lineStart, bodyStart: next < 0 ? raw.length : next + 1 };
    }
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
    return { ok: false, why: String(e.message || e).slice(0, 60) };
  }
}

const skillsDir = join(homedir(), ".dsh", "skills");
let fixed = 0;
for (const name of BROKEN) {
  const p = join(skillsDir, name, "SKILL.md");
  const raw = readFileSync(p, "utf8");
  const before = parseCheck(raw);
  if (before.ok) { console.log(`[${name}] 已是好的，跳过`); continue; }

  // 定位 frontmatter 块
  const nl = raw.indexOf("\n");
  const closing = findClosing(raw, nl + 1);
  const block = raw.slice(nl + 1, closing.start);
  const body = raw.slice(closing.bodyStart);

  // 抽出警告行（`> ` 开头），其余保留
  const warned = block.split(/\r?\n/).filter((l) => /^> /.test(l));
  const kept = block.split(/\r?\n/).filter((l) => !/^> /.test(l)).join("\n");

  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const newRaw = raw.slice(0, nl + 1)                       // "---\n"
    + kept + eol
    + "---" + eol
    + (warned.length ? warned.join(eol) + eol + eol : "")
    + body;

  const after = parseCheck(newRaw);
  if (!after.ok) {
    console.log(`[${name}] ❌ 变换后仍解析失败（${after.why}），未写回`); continue;
  }
  copyFileSync(p, p + ".bak-frontmatter");                  // 备份原文件
  writeFileSync(p, newRaw, "utf8");                          // 无 BOM
  fixed++;
  console.log(`[${name}] ✅ 已修复（移出 ${warned.length} 行警告到正文）`);
}

console.log(`\n残差: ${fixed}/${BROKEN.length} 个已修复并复验通过`);
console.log("复验清单（全部文件应 ✅）：");
for (const name of BROKEN) {
  const r = parseCheck(readFileSync(join(skillsDir, name, "SKILL.md"), "utf8"));
  console.log(`  [${name}] ${r.ok ? "✅" : "❌ " + r.why}`);
}
