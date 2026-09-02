// 「加强审查」：决定借鉴什么之前，先测本会话真实痛点，别按榜单热度选。
// 判据：我在哪类命令上真的失败过？失败几次？—— 有数据才谈工具。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const SID = "aa5ede27";
const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p);
  }
  return o;
}
const buf = readFileSync(find(ROOT).find((x) => x.includes(SID)));
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

// 配对 tool/call -> tool/result
// 🔴 实测字段真相（我猜错两次，每次都是 0 命中，全靠 dump 才定案）：
//   tool/call   : data.callId · data.name
//   tool/result : data.message.source.callId          ← 嵌套 2 层
//   输出正文    : data.message.content[0].content[0].text  ← 嵌套 4 层
//   isError     : data.message.content[0].isError     ← 不在 message 上，全会话 0 条为 true
// 教训：越往深猜错得越离谱。第一次猜 data.callId（配对 0），第二次猜 message.content
// 是文本数组（命中 0）。必须 dump 到叶子再写判据。
const calls = new Map();
for (const e of evs) if (e.type === "tool/call" && e.data && e.data.callId) calls.set(e.data.callId, e.data);
const results = [];
for (const e of evs) {
  if (e.type !== "tool/result" || !e.data || !e.data.message) continue;
  const m = e.data.message;
  const c = m.source && m.source.callId ? calls.get(m.source.callId) : null;
  const tr = Array.isArray(m.content) ? m.content[0] : null;
  let body = "";
  if (tr && Array.isArray(tr.content)) body = tr.content.map((x) => (x && x.text) || "").join("\n");
  else if (tr && typeof tr.content === "string") body = tr.content;
  results.push({ name: c ? c.name : "?", msg: body, isError: !!(tr && tr.isError) });
}
console.log("=== 配对结果 ===");
console.log("  tool/call = " + calls.size + "   配对成功 tool/result = " + results.length);
console.log("  正文非空 = " + results.filter((r) => r.msg.length > 0).length
  + "   isError=true = " + results.filter((r) => r.isError).length);
console.log("  未能配到 name 的 = " + results.filter((r) => r.name === "?").length);

// 关键：本机 PS5.1 特有的失败形态（不看 isError，看输出正文里的真实报错）
const PATTERNS = [
  ["PS 语法/格式错误", /ParserError|FormatError|在设置字符串格式时出错|Unexpected token|表达式或语句中包含意外的标记/],
  ["PS 类型/成员错误", /无法.*方法|MethodNotFound|不包含名为|PropertyNotFound|CannotConvert|无法将.*转换/],
  ["PS 参数绑定错误", /ParameterBindingException|无法处理参数|参数.*为 null|MissingArgument/],
  ["路径/文件不存在", /ObjectNotFound|找不到路径|does not exist|ENOENT|无法找到路径/],
  ["Node ESM/模块错误", /ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_ESM_URL_SCHEME|Cannot find module|SyntaxError/],
  ["非零退出", /\[exit code: [1-9]/],
];
const hits = new Map(PATTERNS.map(([k]) => [k, []]));
let anyFail = 0;
for (const r of results) {
  let matched = false;
  for (const [k, re] of PATTERNS) if (re.test(r.msg)) { hits.get(k).push(r); matched = true; }
  if (matched) anyFail++;
}
console.log("\n=== 真实失败形态分布（按输出正文，不依赖 isError）===");
for (const [k] of PATTERNS) {
  const arr = hits.get(k);
  console.log("  " + String(arr.length).padStart(3) + "  " + k
    + "   工具分布: " + [...new Set(arr.map((r) => r.name))].slice(0, 4).join(","));
}
console.log("\n  有任一失败形态的调用 = " + anyFail + " / " + results.length
  + "  (" + (100 * anyFail / results.length).toFixed(1) + "%)");

// PS 语法错误的实际样本（这决定要不要做 PS5.1 检查器）
const ps = hits.get("PS 语法/格式错误");
console.log("\n=== PS 语法/格式错误样本（决定是否值得建检查器）===");
console.log("  matched/total = " + ps.length + "/" + results.length);
console.log("  未匹配样本（就是这些真实失败）：");
if (!ps.length) console.log("    （无 —— 说明这不是真痛点，不该为它建工具）");
ps.slice(0, 5).forEach((r) => console.log("    - [" + r.name + "] " + r.msg.replace(/\s+/g, " ").slice(0, 110)));

// 退出码非零的分布（哪类操作最常失败）
const ex = hits.get("非零退出");
console.log("\n=== 非零退出的工具分布 ===");
const byTool = new Map();
for (const r of ex) byTool.set(r.name, (byTool.get(r.name) || 0) + 1);
[...byTool.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log("  " + String(c).padStart(3) + "  " + n));
