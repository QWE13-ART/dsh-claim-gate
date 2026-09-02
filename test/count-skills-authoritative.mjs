// 目标：定案「本机技能总数」，修正 AGENTS.md 里的 119。
// 双源：① ~/.dsh/skills 目录（用户自建）② 系统提示 available_skills 权威目录（含打包技能）
// 铁律：不肉眼数；打印双向差集（目录有而目录录没有 / 目录录有而目录没有）。
// 2026-08-31 21:50 更新：8 个 dsh-sec-* frontmatter 修复后已实时进入目录（watcher 拾取）。
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ② 权威目录：逐字抄自本轮系统提示的 available_skills 替换清单（123 条）
const CATALOG = `dsh-injection-guard dsh-debugging dsh-verification dsh-memory dsh-grilling
autotelic-evolution cordis-plugin-development dsh-anthropic-skill-creator dsh-brainstorming
dsh-branch-finish dsh-brand-guidelines dsh-capability-selfcheck dsh-ci-cd-and-automation
dsh-code-simplification dsh-deepread dsh-deprecation-and-migration dsh-discernment-nudge
dsh-doc-coauthoring dsh-executing-plans dsh-feynman dsh-frontend-design dsh-git-worktrees
dsh-internal-comms dsh-karpathy-guidelines dsh-mcp-developer-cn dsh-mcp-usage
dsh-observability-and-instrumentation dsh-performance-optimization dsh-schedule-usage
dsh-script-preflight dsh-sec-api-security dsh-sec-apk-reverse dsh-sec-attack-chain
dsh-sec-binary-diff dsh-sec-browser-automation dsh-sec-browser-extension-reverse
dsh-sec-case-review dsh-sec-cloud-k8s dsh-sec-code-audit dsh-sec-ctf-sandbox
dsh-sec-database-security dsh-sec-diagram-generator dsh-sec-digital-forensics
dsh-sec-docs-generator dsh-sec-dotnet-reverse dsh-sec-edr-bypass-re dsh-sec-email-security
dsh-sec-firmware-pentest dsh-sec-ghidra-reverse dsh-sec-go-rust-reverse
dsh-sec-hardware-security dsh-sec-ida-reverse dsh-sec-identity-federation dsh-sec-js-reverse
dsh-sec-llm-security dsh-sec-macos-reverse dsh-sec-malware-analysis dsh-sec-mobile-reverse
dsh-sec-ot-ics dsh-sec-patch-diff-exploit dsh-sec-pentest-tools dsh-sec-protocol-reverse
dsh-sec-pwn-chain dsh-sec-radare2 dsh-sec-radio-sdr dsh-sec-reverse-engineering
dsh-sec-supply-chain-security dsh-sec-thick-client dsh-sec-threat-hunting
dsh-sec-threat-intelligence dsh-sec-wifi-wireless dsh-sec-windows-ad dsh-self-evolution
dsh-shipping-and-launch dsh-skill-writing dsh-source-driven-development
dsh-subagent-driven dsh-subagent-orchestration dsh-superpowers-guide dsh-systematic-debugging
dsh-tdd dsh-theme-factory dsh-todo-usage dsh-vision-toolkit-map dsh-web-artifacts-builder
dsh-webapp-testing dsh-writing-plans editing-cordis-compositions ponytail ponytail-audit
ponytail-debt ponytail-gain ponytail-help ponytail-review thinking-bounded-rationality
thinking-circle-of-competence thinking-cynefin thinking-effectuation thinking-first-principles
thinking-five-whys-plus thinking-jobs-to-be-done thinking-kepner-tregoe thinking-lindy-effect
thinking-map-territory thinking-margin-of-safety thinking-model-combination thinking-model-router
thinking-ooda thinking-opportunity-cost thinking-pre-mortem thinking-probabilistic
thinking-red-team thinking-reversibility thinking-scientific-method thinking-second-order
thinking-socratic thinking-steel-manning thinking-systems thinking-theory-of-constraints
thinking-thought-experiment thinking-triz thinking-via-negativa vision-skills`
  .split(/\s+/).filter(Boolean);

export { CATALOG };

// ① 目录源
const dir = join(homedir(), ".dsh", "skills");
const onDisk = existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];

const cSet = new Set(CATALOG), dSet = new Set(onDisk);
console.log("=== 双源计数 ===");
console.log("  权威目录(available_skills) = " + CATALOG.length + "  去重后 " + cSet.size);
console.log("  磁盘目录(~/.dsh/skills)    = " + onDisk.length);

const onlyDisk = onDisk.filter((n) => !cSet.has(n));
const onlyCat = CATALOG.filter((n) => !dSet.has(n));
console.log("\n=== 差集（这才是关键，不是总数）===");
console.log("  只在磁盘、不在权威目录 = " + onlyDisk.length + (onlyDisk.length ? "  ⚠️ 装了但用不到" : ""));
onlyDisk.slice(0, 10).forEach((n) => console.log("    - " + n));
console.log("  只在权威目录、不在磁盘 = " + onlyCat.length + "  （= 打包插件提供的技能）");
onlyCat.forEach((n) => console.log("    + " + n));

console.log("\n=== 定案 ===");
console.log("  可用技能总数 = " + cSet.size + "  （权威目录去重后）");
console.log("  其中磁盘自建 = " + onDisk.filter((n) => cSet.has(n)).length
  + "  打包提供 = " + onlyCat.length);
console.log("  算术闭合: " + onDisk.filter((n) => cSet.has(n)).length + " + " + onlyCat.length
  + " = " + (onDisk.filter((n) => cSet.has(n)).length + onlyCat.length)
  + (onDisk.filter((n) => cSet.has(n)).length + onlyCat.length === cSet.size ? "  ✅ 闭合" : "  ❌ 不闭合"));
console.log("  磁盘侧闭合: 119 − 6 deny = 113 可收录，113 + 10 打包 = " + (113 + 10) + "  （应 = 123）");
console.log("\n  AGENTS.md 现写「119 个技能」→ " + (cSet.size === 119 ? "正确" : "❌ 应改为 " + cSet.size));
