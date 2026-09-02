#!/usr/bin/env node
// 2026-08-31: 脚本起飞前 lint 门（dsh-script-preflight 配套工具）
// 自动识别脚本类型 → 跑对应 linter → 汇总报告（fail 则 exit 1）
// 用法: node preflight-lint.mjs <脚本路径...>
// 支持: .ps1 → Parser+PSScriptAnalyzer | .mjs/.js/.cjs → node --check | .sh/.bash → shellcheck | .py → py_compile
import { existsSync, copyFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, basename } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("用法: node preflight-lint.mjs <脚本路径...>");
  process.exit(2);
}

// ---- linter 定位（绝对路径，避免已运行进程 PATH 快照问题）----
const NODE = "C:/Users/L/.workbuddy/binaries/node/versions/22.22.2/node.exe";
const PYTHON = [
  "C:/Users/L/AppData/Local/Programs/Python/Python311/python.exe",
  "E:/DeepTutor/venv/Scripts/python.exe",
  "python",
].find((p) => p === "python" || existsSync(p));
const PSSA = [
  join(process.env.USERPROFILE, ".local/share/ps-modules/PSScriptAnalyzer/1.25.0/PSScriptAnalyzer.psd1"),
  join(process.env.USERPROFILE, ".local/share/powershell/Modules/PSScriptAnalyzer/1.25.0/PSScriptAnalyzer.psd1"),
  join(homedir(), ".local/share/ps-modules/PSScriptAnalyzer/1.25.0/PSScriptAnalyzer.psd1"),
].find((p) => existsSync(p));
const SHELLCHECK = [
  "C:/Users/L/AppData/Local/Microsoft/WinGet/Links/shellcheck.exe",
  "C:/Users/L/.local/bin/shellcheck.exe",
  "C:/Program Files/shellcheck/shellcheck.exe",
].find((p) => existsSync(p));

// Standards 轴审查补做（2026-08-31）：spawnSync 在 linter 本身没跑起来时返回
// status=null + error.code=ENOENT，此时 status!==0 会被当成"检查失败"，但原因是
// 环境问题而非脚本问题 —— 必须区分，否则错误消息误导（显示"语法错误"+空 stderr）。
function runLinter(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  if (r.error || r.status === null) {
    const why = r.error ? r.error.code || r.error.message : "进程被信号终止(" + r.signal + ")";
    return { spawnFailed: true, out: "⚠️ linter 未能运行: " + cmd + " (" + why + ") —— 这是环境问题，不是脚本问题" };
  }
  return { spawnFailed: false, status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function lint(file) {
  const ext = file.split(".").pop().toLowerCase();
  const label = file.split(/[\\/]/).pop();
  if (!existsSync(file)) return { label, ok: false, out: "❌ 文件不存在: " + file };
  if (ext === "mjs" || ext === "js" || ext === "cjs") {
    // 审查缺陷 3：node 22 按扩展名判模块格式，且只认小写（.MJS → ERR_UNKNOWN_FILE_EXTENSION，
    // 好文件被误报语法错误）。大写扩展名时拷成临时小写文件再 --check（实测 2026-08-31）。
    let target = file;
    let tmp = null;
    const rawExt = file.slice(file.lastIndexOf("."));
    if (rawExt !== rawExt.toLowerCase()) {
      // 随机后缀：Date.now() 在并发调用下会碰撞
      const uniq = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      tmp = join(tmpdir(), "preflight-" + uniq + "-" + basename(file).toLowerCase());
      copyFileSync(file, tmp);
      target = tmp;
    }
    const r = runLinter(NODE, ["--check", target]);
    if (tmp) { try { unlinkSync(tmp); } catch { /* 临时文件清理失败不影响判定 */ } }
    if (r.spawnFailed) return { label, ok: false, out: r.out };
    return { label, ok: r.status === 0, out: r.status === 0 ? "✅ node --check 通过" : "❌ 语法错误:\n" + r.stderr.trim() };
  }
  if (ext === "ps1") {
    // 审查缺陷 1：PSScriptAnalyzer 不报告解析级错误（未闭合括号等），必须先用
    // Parser::ParseFile 做语法兜底 —— 否则坏 ps1 会拿到绿灯（实测 2026-08-31）。
    // 注入维度已实测安全：单引号字符串不插值，'→'' 转义后 $(...)/; 均按字面路径处理。
    const q = file.replace(/'/g, "''");
    const parseCmd =
      "$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('" +
      q +
      "', [ref]$null, [ref]$errs); if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { 'ParseError: ' + $_.Message } } else { 'PARSE_OK' }";
    const pr = runLinter("powershell", ["-NoProfile", "-Command", parseCmd]);
    if (pr.spawnFailed) return { label, ok: false, out: pr.out };
    const pout = pr.stdout.trim() || pr.stderr.trim();
    if (pout !== "PARSE_OK") return { label, ok: false, out: "❌ 语法错误:\n" + pout };
    if (!PSSA) return { label, ok: true, out: "✅ 语法通过（PSScriptAnalyzer 未找到，规则检查跳过）" };
    const ps = [
      "Import-Module '" + PSSA + "' -Force;",
      "$r = Invoke-ScriptAnalyzer -Path '" + q + "' -Severity Error,Warning;",
      "if ($r) { $r | ForEach-Object { '{0}: {1}: {2}' -f $_.Severity, $_.RuleName, $_.Message } } else { 'OK' }",
    ].join(" ");
    const r = runLinter("powershell", ["-NoProfile", "-Command", ps]);
    if (r.spawnFailed) return { label, ok: false, out: r.out };
    const out = r.stdout.trim() || r.stderr.trim();
    // 审查缺陷 2：声明了 -Severity Error,Warning，判定就必须拦 Warning —— 只有 "OK" 算通过。
    const ok = out === "OK";
    return { label, ok, out: ok ? "✅ 语法 + PSScriptAnalyzer 通过" : "❌ 问题:\n" + out };
  }
  if (ext === "sh" || ext === "bash") {
    if (!SHELLCHECK) return { label, ok: true, out: "⚠️ shellcheck 未找到，跳过（本机 0.11.0 应存在）" };
    const r = runLinter(SHELLCHECK, [file]);
    if (r.spawnFailed) return { label, ok: false, out: r.out };
    const out = r.stdout.trim();
    return { label, ok: out === "", out: out === "" ? "✅ shellcheck 通过" : "❌ 问题:\n" + out };
  }
  if (ext === "py") {
    const r = runLinter(PYTHON, ["-m", "py_compile", file]);
    if (r.spawnFailed) return { label, ok: false, out: r.out };
    return { label, ok: r.status === 0, out: r.status === 0 ? "✅ py_compile 通过" : "❌ 语法错误:\n" + r.stderr.trim() };
  }
  return { label, ok: true, out: "⚠️ 未知类型 ." + ext + "，跳过 lint" };
}

let allOk = true;
for (const f of args) {
  const r = lint(f);
  if (!r.ok) allOk = false;
  console.log("--- " + r.label + " ---");
  console.log(r.out);
}
console.log("");
console.log(allOk ? "🎉 全部通过，可以执行" : "🚫 有失败，先修再跑（铁律 1）");
process.exit(allOk ? 0 : 1);
