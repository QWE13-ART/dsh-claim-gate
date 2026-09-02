// tool-folder 侧验证：工具名子词召回 + 回归红线。
// 用真实工具名（含 mcp__ 前缀与连字符），不是我编的样本。
import { pathToFileURL } from "node:url";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-tool-folder/lib/bm25.js").href);

console.log("=== tokenize 修后输出 ===");
for (const s of ["mcp__open-design__start_run", "mcp__sequential-thinking__sequentialthinking",
                 "web_search", "lesson_save", "dsh-verification"]) {
  console.log("  " + s.padEnd(46) + " → [" + BM.tokenize(s).join(" | ") + "]");
}

// 真实工具名池（本机部分真名 + 描述片段）
const tools = [
  ["mcp__open-design__start_run", "Open Design brief card for a new artifact run"],
  ["mcp__sequential-thinking__sequentialthinking", "dynamic and reflective problem-solving through thoughts"],
  ["mcp__security-audit__scan_config", "扫描配置文件安全错配 Dockerfile K8s Terraform 只读"],
  ["mcp__codegraph__codegraph_explore", "PRIMARY TOOL returns verbatim source of relevant symbols"],
  ["mcp__playwright__browser_snapshot", "Perform click on a web page accessibility snapshot"],
  ["mcp__github__search_repositories", "Find GitHub repositories by name description readme topics"],
  ["web_search", "Search the web for current information queries array"],
  ["lesson_save", "即时沉淀一条失败教训到教训库"],
  ["mem_save_prompt", "保存当前会话的用户意图 需求 prompt"],
  ["xs_session_read", "读取指定会话最近的消息记录"],
  ["mcp__context7__get-library-docs", "Retrieves up-to-date documentation and code examples"],
  ["validate_dsh_ui", "Validate the JSON body of a dsh-ui fence before emitting"],
];
const docs = tools.map(([id, d]) => ({ id, text: id + " " + d }));
const idx = BM.buildIndex(docs);

// 关键：子词 query（修前必空）
const CASES = [
  ["design", "mcp__open-design__start_run"],
  ["sequential", "mcp__sequential-thinking__sequentialthinking"],
  ["codegraph", "mcp__codegraph__codegraph_explore"],
  ["playwright", "mcp__playwright__browser_snapshot"],
  ["github", "mcp__github__search_repositories"],
  ["lesson", "lesson_save"],
  ["session", "xs_session_read"],
  ["context7", "mcp__context7__get-library-docs"],
  ["安全 配置 扫描", "mcp__security-audit__scan_config"],
  ["教训 沉淀", "lesson_save"],
];
let ok = 0; const fail = [];
for (const [q, want] of CASES) {
  const names = BM.search(idx, q, 4).map((i) => docs[i].id);
  if (names.includes(want)) ok++; else fail.push(q + " → 期望 " + want + "，实得 [" + (names.slice(0,2).join(",") || "空") + "]");
}
console.log("\n=== 工具名子词召回 ===");
console.log("  matched/total = " + ok + "/" + CASES.length);
console.log("  未匹配样本：");
if (!fail.length) console.log("    （无）");
fail.forEach((f) => console.log("    - " + f));

// 精确全名仍必须命中（防「加了子词反而稀释精确匹配」）
console.log("\n=== 精确全名不退化检查 ===");
let ex = 0; const exFail = [];
for (const [id] of tools) {
  const top = BM.search(idx, id, 1).map((i) => docs[i].id)[0];
  if (top === id) ex++; else exFail.push(id + " → top 变成 " + top);
}
console.log("  matched/total = " + ex + "/" + tools.length + "  (查全名，自己必须排第一)");
console.log("  未匹配样本：");
if (!exFail.length) console.log("    （无）");
exFail.forEach((f) => console.log("    - " + f));
