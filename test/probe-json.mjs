#!/usr/bin/env node
// 2026-08-31: 通用 JSON 结构探查器（probe shape）
// 输入任意 JSON 文件 → 输出字段层级树 + 类型分布 + 首样本（截断）
// 治"数据结构靠猜"痛点（schema-contract 教训簇）：写解析代码前先 probe 真实形状
// 用法: node probe-json.mjs <json文件> [--depth 5] [--sample 80] [--top N]
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file || !existsSync(file)) {
  console.error("用法: node probe-json.mjs <json文件> [--depth 5] [--sample 80] [--top N]");
  process.exit(2);
}
// 参数解析：--key value；键不存在或值非法（如 --depth abc → NaN）时回退默认值。
// 修复 2026-08-31（Standards 轴补做）：原来 NaN 会静默流入 walk → level > NaN 恒 false
// → 永不截断、深层 JSON 全展开，用户毫无察觉。
function opt(name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const n = parseInt(args[i + 1], 10);
  return Number.isNaN(n) ? def : n;
}
// depth 上限 100：walk 是递归，极端值（--depth 99999）会 RangeError 栈溢出崩溃
const depth = Math.min(opt("--depth", 5), 100);
const sampleLen = opt("--sample", 80);
const topN = opt("--top", 8);

// 读文件 + 剥 BOM
let raw = readFileSync(file, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error("❌ JSON.parse 失败: " + e.message);
  process.exit(1);
}

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

// 数组元素类型分布（同构/异构判断）
function elemStats(arr, limit = 50) {
  const counts = {};
  for (const e of arr.slice(0, limit)) {
    const t = typeOf(e);
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

// 核心：递归遍历结构（只走 shape，不展开大数据）
function walk(node, path, out, level) {
  if (level > depth) return;
  const t = typeOf(node);
  if (t === "object") {
    const keys = Object.keys(node);
    for (const k of keys.slice(0, topN)) {
      const v = node[k];
      const vt = typeOf(v);
      const childPath = path ? path + "." + k : k;
      const sample = vt === "string" ? JSON.stringify(v).slice(0, sampleLen) : "";
      const count = vt === "array" ? "[" + v.length + "]" : vt === "object" ? "{" + Object.keys(v).length + "}" : "";
      out.push("  ".repeat(level) + k + ": " + vt + count + (sample ? " = " + sample : ""));
      if (vt === "object" || vt === "array") walk(v, childPath, out, level + 1);
    }
    if (keys.length > topN && topN > 0) out.push("  ".repeat(level) + "... 还有 " + (keys.length - topN) + " 个键（--top 调大）");
  } else if (t === "array") {
    const stats = elemStats(node);
    const statsStr = Object.entries(stats).map(([k, v]) => k + "x" + v).join(", ");
    out.push("  ".repeat(level) + "[] 元素类型: " + statsStr + "（前 50 采样）");
    const first = node.slice(0, 50).find((e) => typeOf(e) === "object"); // 与 elemStats 采样一致，避免大数组全遍历
    if (first) {
      const keys = Object.keys(first);
      for (const k of keys.slice(0, topN)) {
        const vt = typeOf(first[k]);
        const sample = vt === "string" ? JSON.stringify(first[k]).slice(0, sampleLen) : "";
        out.push("  ".repeat(level + 1) + "[0]." + k + ": " + vt + (sample ? " = " + sample : ""));
      }
    }
  }
}

const out = [];
const rootT = typeOf(data);
out.push("=== 根类型: " + rootT + (rootT === "array" ? " [" + data.length + "]" : rootT === "object" ? " {" + Object.keys(data).length + "}" : "") + " ===");
walk(data, "", out, 0);
console.log(out.join("\n"));
