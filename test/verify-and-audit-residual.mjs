// ① 核验 AGENTS.md 注入预算（新规则刚写入）
// ② 给本会话所有分析脚本补残差自曝检查 —— 这是新规则要求的，先看现状有多少脚本缺它
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const A = join(homedir(), ".dsh", "AGENTS.md");
const buf = readFileSync(A);
console.log("=== AGENTS.md 预算 ===");
console.log("  字节 = " + buf.length + " / 65536   余量 = " + (65536 - buf.length));
console.log("  BOM 前3字节 = " + [...buf.subarray(0,3)].join(",") + "  (35,32,230 = 无 BOM)");
const t = buf.toString("utf8");
for (const probe of ["统计脚本必须自曝残差", "matched/total", "纯结构事实", "data.message", "误伤这条规则自己推荐的行为"]) {
  console.log("  含「" + probe + "」= " + t.includes(probe));
}

// ② 残差自曝审计：本会话写的分析脚本，有几个打印了 matched/total 或未匹配样本？
const DIR = "E:\\DSH-Data\\dsh-claim-gate\\test";
const RESIDUAL = /(未匹配|unmatched|matched\s*\/\s*total|matched\b.*total|残差|漏掉)/;
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".mjs")) : [];
let has = 0;
const missing = [];
console.log("\n=== 残差自曝审计（新规则要求）===");
for (const f of files) {
  const src = readFileSync(join(DIR, f), "utf8");
  const ok = RESIDUAL.test(src);
  if (ok) has++; else missing.push(f);
}
// 本脚本自身遵守新规则：报 matched/total + 未匹配样本
console.log("  matched/total = " + has + "/" + files.length + "  (打印了残差的脚本数)");
console.log("  未匹配样本（缺残差自曝的脚本，前 5 条）：");
missing.slice(0, 5).forEach((f) => console.log("    - " + f));
if (missing.length > 5) console.log("    ...另有 " + (missing.length - 5) + " 个");
