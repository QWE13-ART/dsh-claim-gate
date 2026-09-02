// 2026-08-31: 验证意图词配置——口语变体已写入配置（v2），本脚本改为直接验证配置本身
// 运行: node E:\DSH-Data\dsh-claim-gate\test\verify-intent-fix.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js");
const yaml = req("yaml");
const y = yaml.parse(readFileSync(join(homedir(), ".dsh/profiles/desktop/cordis.patch.yml"), "utf8"));
const cfg = y.find((n) => n.id === "skill-folder").config;
const { routeHint } = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/skill-search.js").href);

// v2: 直接验证配置（口语变体已写入 cordis.patch.yml，不再内存补丁）
const newAliases = cfg.aliases;
const newCfg = cfg;
const pool = Object.keys(newAliases).map((name) => ({ name, description: "desc " + name }));

// 1) 重复词检查
const wordOwner = new Map();
for (const [s, words] of Object.entries(newAliases)) for (const w of words) {
  if (!wordOwner.has(w)) wordOwner.set(w, []);
  wordOwner.get(w).push(s);
}
const dups = [...wordOwner.entries()].filter(([, v]) => v.length > 1);
console.log("=== 重复词检查 ===");
console.log(dups.length === 0 ? "无重复 ✅" : dups.map(([w, v]) => w + "->" + v.join("+")).join("\n"));

// 2) 原失败用例回归
const tests = [
  ["帮我查一下为什么慢", "dsh-debugging"],
  ["任务做完了帮我检查", "dsh-verification"],
  ["帮我写个计划", "dsh-writing-plans"],
  ["这计划帮我执行", "dsh-executing-plans"],
  ["帮我记一下这个", "dsh-memory"],
  ["以后别忘了这个", "dsh-memory"],
  ["这代码有安全风险吗", null],
  ["帮我验证一下结果", "dsh-verification"], // 回归
  ["帮我记住这个", "dsh-memory"], // 回归
  ["这个报错怎么解决", "dsh-debugging"], // 回归
];
console.log("");
console.log("=== 回归测试 ===");
let pass = 0;
for (const [msg, expect] of tests) {
  const got = routeHint(pool, msg, newCfg);
  const ok = got === expect;
  if (ok) pass++;
  console.log((ok ? "✅" : "❌") + " " + msg + " -> " + got + (ok ? "" : " (期望" + expect + ")"));
}
console.log("通过率: " + pass + "/" + tests.length);
