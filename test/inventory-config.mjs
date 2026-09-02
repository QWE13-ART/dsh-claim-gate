// 2026-08-31: 盘点工具资产（配置层）——MCP/插件节点 + 启用状态
// 运行: node E:\DSH-Data\dsh-claim-gate\test\inventory-config.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const req = createRequire("E:/DeepSeek Harness/DeepSeek Harness Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js");
const yaml = req("yaml");
const y = yaml.parse(readFileSync(join(homedir(), ".dsh/profiles/desktop/cordis.patch.yml"), "utf8"));

const mcpNodes = [];
const pluginNodes = [];
const seen = new Set();
for (const node of y) {
  if (!node || typeof node !== "object") continue;
  let items = [];
  if (node.insert && Array.isArray(node.insert)) items = node.insert;
  else if (node.id) items = [node];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = item.id || "";
    const name = item.name || "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id.startsWith("mcp-")) mcpNodes.push({ id, enabled: item.disabled !== true, name });
    else if (id) pluginNodes.push({ id, enabled: item.disabled !== true, name });
  }
}

const enabledMcp = mcpNodes.filter((n) => n.enabled);
const disabledMcp = mcpNodes.filter((n) => !n.enabled);
const enabledPlugins = pluginNodes.filter((n) => n.enabled);
const disabledPlugins = pluginNodes.filter((n) => !n.enabled);

console.log("=== MCP 节点: " + mcpNodes.length + " (启用 " + enabledMcp.length + " / 禁用 " + disabledMcp.length + ") ===");
console.log("禁用 MCP: " + disabledMcp.map((n) => n.id).join(", ") || "(无)");
console.log("");
console.log("=== 启用 MCP (" + enabledMcp.length + ") ===");
console.log(enabledMcp.map((n) => n.id).join(", "));
console.log("");
console.log("=== 插件节点: " + pluginNodes.length + " (启用 " + enabledPlugins.length + " / 禁用 " + disabledPlugins.length + ") ===");
console.log("禁用插件: " + disabledPlugins.map((n) => n.id).join(", ") || "(无)");
console.log("");
console.log("=== 启用插件 (" + enabledPlugins.length + ") ===");
console.log(enabledPlugins.map((n) => n.id).join(", "));
