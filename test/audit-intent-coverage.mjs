// 2026-08-31: 意图词覆盖度抽查——用户真实口语 vs routeHint 路由
// 运行: node E:\DSH-Data\dsh-claim-gate\test\audit-intent-coverage.mjs
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
const pool = Object.keys(cfg.aliases).map((name) => ({ name, description: "desc " + name }));

// [用户说法, 期望路由(null=期望不触发)]
const tests = [
  ["这个报错怎么解决", "dsh-debugging"],
  ["帮我查一下为什么慢", "dsh-debugging"],
  ["这结果靠谱吗", null],
  ["任务做完了帮我检查", "dsh-verification"],
  ["写个计划", "dsh-writing-plans"],
  ["这计划帮我执行", "dsh-executing-plans"],
  ["这个设计你觉得怎么样", null],
  ["帮我记一下这个", "dsh-memory"],
  ["以后别忘了这个", "dsh-memory"],
  ["帮我分析一下这个数据", null],
  ["这代码有安全风险吗", null],
  ["帮我查查文档", null],
  ["这事情先别急想清楚再做", null],
];

let miss = 0;
for (const [msg, expect] of tests) {
  const got = routeHint(pool, msg, cfg);
  let note;
  if (expect === null) note = got === null ? "OK-不触发" : "FAIL-误触发->" + got;
  else note = got === expect ? "OK" : "FAIL-期望" + expect + "实际" + got;
  if (note.startsWith("FAIL")) miss++;
  console.log(note + " | " + msg + " -> " + got);
}
console.log("");
console.log("问题数: " + miss + "/" + tests.length);
