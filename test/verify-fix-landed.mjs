// 收尾核验：修复真在磁盘上（不是「我以为改了」），且两仓一致。
// 遵守新规则：打印 matched/total + 未匹配样本。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const NODE = "C:/Users/L/.workbuddy/binaries/node/versions/22.22.2/node.exe";
const TARGETS = [
  ["skill-folder", "E:/DSH-Data/dsh-skill-folder/lib/bm25.js", "E:/DSH-Data/dsh-skill-folder/test/tokenize.test.js"],
  ["tool-folder",  "E:/DSH-Data/dsh-tool-folder/lib/bm25.js",  "E:/DSH-Data/dsh-tool-folder/test/tokenize.test.js"],
];
const PROBE = "t.split(/[-_]+/)";        // 修复的那行代码字面量
let ok = 0; const missing = [];
console.log("=== 修复落地核验（grep 到代码 + node --check + 回归文件存在）===");
for (const [name, lib, test] of TARGETS) {
  const src = readFileSync(lib, "utf8");
  const hasFix = src.includes(PROBE);
  const guard = src.includes("part.length > 1");
  let syntax = false;
  try { execFileSync(NODE, ["--check", lib], { stdio: "ignore" }); syntax = true; } catch {}
  let hasTest = false, testCount = 0;
  try { const t = readFileSync(test, "utf8"); hasTest = true; testCount = (t.match(/^test\(/gm) || []).length; } catch {}
  const sha = createHash("sha256").update(src).digest("hex").slice(0, 12);
  const allGood = hasFix && guard && syntax && hasTest;
  if (allGood) ok++; else missing.push(name);
  console.log("  " + name.padEnd(14) + " 子词split=" + hasFix + "  守卫=" + guard
    + "  --check=" + syntax + "  回归=" + testCount + "条  sha=" + sha);
}
console.log("\n  matched/total = " + ok + "/" + TARGETS.length);
console.log("  未匹配样本：" + (missing.length ? missing.join(", ") : "（无）"));

// 两仓 tokenize 行为是否一致（同一 bug 必须同一修法）
const A = await import("file:///E:/DSH-Data/dsh-skill-folder/lib/bm25.js");
const B = await import("file:///E:/DSH-Data/dsh-tool-folder/lib/bm25.js");
const SAMPLES = ["dsh-debugging", "mcp__open-design__start_run", "utf-8", "a-b", "ponytail", "run-the-thing"];
let same = 0; const diff = [];
for (const s of SAMPLES) {
  const x = A.tokenize(s).join("|"), y = B.tokenize(s).join("|");
  if (x === y) same++; else diff.push(s + "  skill=[" + x + "]  tool=[" + y + "]");
}
console.log("\n=== 两仓 tokenize 行为一致性 ===");
console.log("  matched/total = " + same + "/" + SAMPLES.length);
console.log("  未匹配样本：");
if (!diff.length) console.log("    （无）");
diff.forEach((d) => console.log("    - " + d));
