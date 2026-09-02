// 2026-08-31: 扫描可见技能的 SKILL.md description，标记"触发不友好"（无描述/太短/无触发信号词）
// 运行: node E:\DSH-Data\dsh-claim-gate\test\audit-skill-descriptions.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js");
const yaml = req("yaml");
const y = yaml.parse(readFileSync(join(homedir(), ".dsh/profiles/desktop/cordis.patch.yml"), "utf8"));
const cfg = y.find((n) => n.id === "skill-folder").config;

const base = join(homedir(), ".dsh/skills");
const all = readdirSync(base, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "SKILL.md")))
  .map((e) => e.name);
const visible = all.filter((s) => !cfg.deny.includes(s));

const issues = [];
let okCount = 0;
for (const s of visible) {
  const raw = readFileSync(join(base, s, "SKILL.md"), "utf8");
  let desc = "";
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    const fm = m[1];
    const dm = fm.match(/^description:\s*(.+)$/m);
    if (dm) {
      desc = dm[1].trim();
      // YAML 多行块: description: | 后跟缩进行
      if (desc === "|" || desc === ">-" || desc === "|" + "") {
        const lines = fm.split(/\r?\n/);
        const idx = lines.findIndex((l) => /^description:/.test(l));
        const block = [];
        for (let i = idx + 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line.startsWith(" ") && line.trim() !== "") break;
          if (line.trim() !== "") block.push(line.trim());
        }
        desc = block.join(" ");
      }
    }
  }
  if (!desc) {
    issues.push(s + ": NO DESCRIPTION");
    continue;
  }
  if (desc.length < 40) {
    issues.push(s + ": 太短(" + desc.length + "): " + desc);
    continue;
  }
  const hasSignal = /使用|use|when|When|场景|触发|用途/.test(desc);
  if (!hasSignal) {
    issues.push(s + ": 无触发信号词: " + desc.slice(0, 70));
    continue;
  }
  okCount++;
}
console.log("=== 可见技能: " + visible.length + " | 描述 OK: " + okCount + " | 有问题: " + issues.length + " ===");
console.log(issues.join("\n"));
