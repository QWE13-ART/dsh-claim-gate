// 「加强审查」＋「看看有什么可以直接用的」：先查本机实况，别推荐已有的。
// 铁律：能力事实只能查询不能推断。这里查三条独立路径——PATH 可执行 / 已知安装目录 / npm 全局。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// 候选：榜单里对本机真正可能有用的（Windows + 已有 PS5.1 + 已有大量 .mjs 脚本）
const CANDS = [
  ["shellcheck",   ["shellcheck.exe"],            "shell 静态分析；本机 shell 是 PS5.1，收益低"],
  ["shfmt",        ["shfmt.exe"],                 "shell 格式化；同上"],
  ["bats",         ["bats.exe", "bats.bat"],      "bash 测试框架；本机用 node:test"],
  ["just",         ["just.exe"],                  "make 替代，跑固定命令集"],
  ["mise",         ["mise.exe"],                  "版本+env+task 三合一"],
  ["uv",           ["uv.exe"],                    "Python 工具链标准"],
  ["gum",          ["gum.exe"],                   "脚本交互 UI"],
  ["atuin",        ["atuin.exe"],                 "shell 历史 SQLite"],
  ["starship",     ["starship.exe"],              "提示符"],
  ["oh-my-posh",   ["oh-my-posh.exe"],            "Windows 友好提示符"],
  ["chezmoi",      ["chezmoi.exe"],               "dotfiles 管理"],
  ["direnv",       ["direnv.exe"],                "目录级 env"],
  ["gsudo",        ["gsudo.exe"],                 "Windows sudo"],
  ["scoop",        ["scoop.cmd", "scoop.ps1"],    "包管理"],
  ["winget",       ["winget.exe"],                "官方包管理"],
  ["choco",        ["choco.exe"],                 "包管理"],
  ["gitleaks",     ["gitleaks.exe"],              "已知已装（pre-commit hook）"],
  ["pre-commit",   ["pre-commit.exe"],            "git hooks 框架"],
  ["lefthook",     ["lefthook.exe"],              "git hooks，Go 单二进制"],
  ["ahk",          ["AutoHotkey.exe", "AutoHotkey64.exe"], "Windows 自动化"],
  ["nu",           ["nu.exe"],                    "nushell"],
  ["pwsh",         ["pwsh.exe"],                  "PowerShell 7（本机现用 5.1）"],
];

// 扫 PATH + 常见安装根
const roots = [];
for (const p of (process.env.PATH || "").split(";")) if (p && existsSync(p)) roots.push(p);
for (const extra of ["C:/Users/L/scoop/shims", "E:/Tools", "C:/ProgramData/chocolatey/bin",
                     "C:/Program Files/AutoHotkey", "C:/Program Files/PowerShell/7",
                     "C:/Users/L/.local/bin", "C:/Users/L/AppData/Local/Microsoft/WindowsApps"]) {
  if (existsSync(extra) && !roots.includes(extra)) roots.push(extra);
}
const index = new Set();
for (const r of roots) {
  try { for (const f of readdirSync(r)) index.add(f.toLowerCase()); } catch {}
}

let have = 0; const missing = [];
console.log("=== 本机实况（扫 " + roots.length + " 个 PATH/安装目录，共 " + index.size + " 个文件名）===");
for (const [name, exes, note] of CANDS) {
  const hit = exes.find((e) => index.has(e.toLowerCase()));
  if (hit) { have++; console.log("  ✅ " + name.padEnd(12) + " → " + hit); }
  else missing.push([name, note]);
}
console.log("\n  matched/total = " + have + "/" + CANDS.length + " 已装");
console.log("\n=== 未装的（含我的评估备注）===");
missing.forEach(([n, note]) => console.log("  ❌ " + n.padEnd(12) + " " + note));

// 本机现有护栏盘点（榜单第三节「护栏三件套」对标）
console.log("\n=== 本机现有护栏 vs 榜单「脚本质量」推荐 ===");
const OWN = [
  ["node --check", "E:/DSH-Data/dsh-claim-gate/test", "语法预检，已在用"],
  ["node --test",  "E:/DSH-Data/dsh-skill-folder/test", "单测，86/86"],
  ["node --test",  "E:/DSH-Data/dsh-tool-folder/test",  "单测，102/102"],
  ["gitleaks hook","E:/DSH-Data/scripts/pre-commit",    "密钥拦截，6 仓已上"],
  ["preflight",    "E:/DSH-Data/scripts/preflight-all.mjs", "真 cordis Context 预检"],
];
let o = 0; const oMiss = [];
for (const [tool, path, note] of OWN) {
  const ex = existsSync(path);
  if (ex) o++; else oMiss.push(path);
  console.log("  " + (ex ? "✅" : "❌") + " " + tool.padEnd(14) + " " + note + "  (" + path.split("/").slice(-2).join("/") + ")");
}
console.log("\n  matched/total = " + o + "/" + OWN.length);
console.log("  未匹配样本：" + (oMiss.length ? oMiss.join(", ") : "（无）"));
