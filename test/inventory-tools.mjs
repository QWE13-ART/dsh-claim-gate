// 2026-08-31: 盘点工具资产（运行时层）——listTools 全量解析 + 双路径闭合
// 运行: node E:\DSH-Data\dsh-claim-gate\test\inventory-tools.mjs <spill文件>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("用法: node inventory-tools.mjs <listTools spill 文件路径>");
  process.exit(1);
}

const raw = readFileSync(file, "utf8");

// 路径 A: JSON 解析（权威）
let tools = [];
try {
  const parsed = JSON.parse(raw);
  tools = parsed.data?.tools || [];
} catch (e) {
  // 可能是带平台包装的 pretty JSON
  console.error("JSON.parse 失败: " + e.message + " —— 尝试找 tools 数组段");
  const m = raw.match(/"tools"\s*:\s*\[([\s\S]*?)\]\s*}/);
  if (m) {
    const json = "{ \"tools\": [" + m[1] + "]}";
    tools = JSON.parse(json).tools;
  }
}

// 路径 B: 正则计数（双路径）
const nameCount = (raw.match(/"name"\s*:/g) || []).length;
const toolNameCount = (raw.match(/"name":\s*"([^"]+)"/g) || []).length;

const names = tools.map((t) => t.name);
const unique = new Set(names);

// 按 server 前缀分组
const groups = new Map(); // server -> [tool names]
for (const n of unique) {
  const server = n.startsWith("mcp__") ? n.split("__").slice(0, 2).join("__") : "(native/内置)";
  if (!groups.has(server)) groups.set(server, []);
  groups.get(server).push(n);
}

console.log("=== 路径 A: JSON 解析 ===");
console.log("tools 条目: " + names.length + " | 去重后: " + unique.size);
console.log("");
console.log("=== 路径 B: 正则计数（双路径闭合）===");
console.log('"name": 出现次数: ' + nameCount + " | name 字段匹配: " + toolNameCount);
console.log("");
console.log("=== 按 server 分组（去重后 " + unique.size + " 个）===");
const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [server, list] of sorted) {
  console.log(server + ": " + list.length + " 个");
  if (server !== "(native/内置)" && list.length <= 12) {
    console.log("    " + list.join(", "));
  }
}
if (groups.has("(native/内置)")) {
  const native = groups.get("(native/内置)");
  console.log("    " + native.join(", "));
}
