// 待办 ①：建 evolution/backup/ 并追补本会话改过的规则文件（skill ⑤ 红线：教训只归档不删除，改规则前要备份）
// 待办 ②：修 evo-trace.mjs 两个已知 bug —— 本脚本先诊断，确认 bug 真实存在再改
import { mkdirSync, existsSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BK = "E:/DSH-Data/.dsh/evolution/backup";
console.log("=== ① 备份目录 ===");
console.log("  改前 existsSync = " + existsSync(BK));
mkdirSync(BK, { recursive: true });
const stamp = "2026-08-31T1945";
const FILES = [
  ["C:/Users/L/.dsh/AGENTS.md", "AGENTS.md"],
  ["C:/Users/L/.dsh/skills/dsh-verification/SKILL.md", "dsh-verification-SKILL.md"],
  ["E:/DSH-Data/dsh-skill-folder/lib/bm25.js", "skill-folder-bm25.js"],
  ["E:/DSH-Data/dsh-tool-folder/lib/bm25.js", "tool-folder-bm25.js"],
];
let ok = 0; const missing = [];
for (const [src, name] of FILES) {
  if (!existsSync(src)) { missing.push(name + "  (源文件不存在: " + src + ")"); continue; }
  const dst = join(BK, stamp + "-" + name);
  copyFileSync(src, dst);
  const same = statSync(src).size === statSync(dst).size;
  if (same) ok++; else missing.push(name + " (大小不一致)");
  console.log("  " + name.padEnd(28) + " → " + statSync(dst).size + " 字节  校验=" + same);
}
console.log("\n  matched/total = " + ok + "/" + FILES.length);
console.log("  未匹配样本：" + (missing.length ? "\n    - " + missing.join("\n    - ") : "（无）"));
console.log("  改后 existsSync = " + existsSync(BK));

// ② 诊断 evo-trace.mjs 的两个 bug（先确认存在，不猜）
console.log("\n=== ② evo-trace.mjs bug 诊断 ===");
const P = "E:/DSH-Data/dsh-claim-gate/test/evo-trace.mjs";
if (!existsSync(P)) { console.log("  文件不存在，跳过"); }
else {
  const src = readFileSync(P, "utf8");
  // bug A：用户消息事件无 data.turn，直接读会得 undefined
  const usesDataTurn = /e\.data\.turn|data\?\.turn/.test(src);
  const hasTurnFallback = /lastTurn|currentTurn|turn\s*\|\|/.test(src);
  console.log("  bug A（用户轮次归属）：读 data.turn = " + usesDataTurn + "  有兜底 = " + hasTurnFallback);
  // bug B：CORRECT 正则会命中 system-reminder / runtime-context 注入块
  const m = src.match(/const\s+CORRECT\s*=\s*(\/[^\n]+)/);
  console.log("  bug B（纠正正则）：" + (m ? m[1].slice(0, 90) : "未找到 CORRECT 定义"));
  const excludesReminder = /system-reminder|runtime.context|Current runtime/.test(src);
  console.log("           是否已排除 system-reminder = " + excludesReminder);
}
