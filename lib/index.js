import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * dsh-claim-gate — turn-boundary claim gate.
 *
 * v0.3.0（2026-09-02 强化，见 docs/v0.3-design.md）：
 *   - F1 词表扩展：新增「X 完成/完毕」结构（调研完成/接入完成/迁移完成…），
 *     补 v0.2 只认「已X」的召回盲区。守卫：结构天然免疫否定插入词（"尚未完成"
 *     不匹配），外加贴词后缀守卫（完成后/前/中/时/再）。
 *   - F2 证据窗口：证据 = 本轮 ∪ 自最近真实用户消息（source.kind ∉ plugin/
 *     skill-catalog）以来的全部工具。治「先取证、后汇报」轮次的必然误报；
 *     无真实用户消息的历史数据回退单轮语义（replay 兼容，旧行为不变）。
 *   - F4 失败撤销：tool/result 正文含 "[exit code: N]"（N≠0）→ 该次调用
 *     不计入验证（call/result 交替栈配对）。
 *   - F8 正文路径修正：v0.2 的 countTestsRun 读 e.data.result —— 真实事件
 *     该字段 0 命中（probe-result-shape：3487 条 tool/result 无 data.result，
 *     正文在 data.message.content[0].content），空跑检测从未在生产生效。
 *     现改读真实路径（兼容旧夹具的 data.result）。
 *   - D5 evidence 摘要：decide 返回 evidence 工具名数组，steer 可点名证据。
 *
 * 保留 v0.2 全部判定契约与教训注释（词表下方）。判定仍纯同步正则，
 * turn-stopping 是 serial 不能阻塞。
 */

// 句内自带硬证据 = 已经取证了，不该再拦。
// 回放实证：误报里 2 条的共同特征是声明句就带了证据「87/87 绿」「83/83 测试背书」。
// ⚠️ 必须写窄：第一版写了 `\d+\s*个?(测试|条|处)` 和裸 `\d+/\d+`，把 turn 112
// 「全部 9 个索引…全部通过」也放行了 —— 那是真阳。降误报不能降到把检测器关掉。
// 只认「N/N」同数比分（测试全绿的固定形态）与 file:line、exit 0。
const INLINE_EVIDENCE = /((\d+)\/\2\b|:\d+(-\d+)?\b|\bexit\s*(code)?\s*[=:]?\s*0\b|EXIT=0)/;

// 他方主体：说的是子智能体/用户/文档完成了什么，不是我的产物。
// 回放实证：turn 105「调研已完成」指子智能体的调研、turn 168「两轴独立发现」指审查子智能体。
// ⚠️ v0.3 收紧为句级判定：只在「该句」内检测，不因句中一个他方词豁免整条消息。
// ⚠️ 不含「调研」——v0.3 审计（audit-blindspots，session-91245193 turn 36/59）证明
// 主 agent 自己调研的汇报「调研完成」被「调研」二字双保险放行（真漏网），故移除该词。
const THIRD_PARTY = /(子智能体|子代理|审查轴|两轴|用户说|你说|报告说)/;

// 「已完成」类声明。v0.3 双轨：
//   track1（v0.2 保留）：已X / X好了 形态
//   track2（v0.3 新增，F1）：动作词 + 完成/完毕 紧邻（"调研完成"）；结构天然免疫
//     "尚未完成/快完成了"（中间隔字不匹配）；后缀守卫查「完成后/前/中/时/再」。
const CLAIM_V02 = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/;
const DONE_ACTION = /(调研|接入|安装|部署|迁移|重构|落地|修复|实施|导出|导入|备份|恢复|合并|提交|推送|拉取|扫描|审计|清理|删除|创建|生成|配置|升级|降级|编译|构建|测试|验证|整合|拆分|撰写|修改|调整)(完成|完毕)/;
// 「完成」紧邻后缀守卫：完成后/完成前/完成中/完成时/完成再（"配置完成后重启"是流程描述）
const DONE_SUFFIX_GUARD = /(?<=完成)(?=[后前中时再])/;

// 否认句式：说「没修好 / 依然复现 / 还是失败」是在报告失败，不是在声称完成。
const DENIAL = /(没修好|没有修好|未修好|依然复现|仍然复现|还是失败|仍然失败|没成功|未解决|仍未|没生效|未生效)/;

// 验证类工具黑名单（否定式判据，v0.2 定案：白名单不可穷举，黑名单可穷举）。
const NON_VERIFY_TOOL = /^(todo_write|render_ui|validate_dsh_ui|ask_user_question|dsh_show_media|dsh_im_return_file|mem_save_prompt|lesson_save|prompt_optimize|create_goal|update_goal)$/;
const VERIFY_CMD = /(grep|Select-String|Test-Path|ReadAllText|ReadAllBytes|npm test|node --test|node --check|\.Contains\()/;
// F12：测试运行命令（空跑检测只适用于它们——调试/分析命令输出含空跑摘要字样不算）
const TEST_CMD = /(npm test|npm run test|node --test|yarn test|pnpm test|npx (mocha|jest|vitest|tsx)|pytest|go test)/i;

// F4：pwsh 等工具失败的宿主标记（measure-real-pain 实测：正文带 [exit code: N]）
const EXIT_FAIL = /\[exit code: [1-9]\d*\]/;

// 空跑检测（vacuous pass）：移植 SWE-bench/swebench/harness/grading.py L32-40。
// v0.3 F8：正文提取改真实路径后此检测才真正在生产生效。
// v0.3 F12：① 只判测试运行类工具（pwsh）的输出，读/搜类工具正文永不判空跑；
// ② 计数形态行首锚定；③ 本文件注释避免写裸空跑摘要词（曾自指误报：
// session-8d0d184b turn 4 —— read 自己源码把注释里的摘要字样当空跑证据）。
const SUITE_RAN = /Executed [1-9]\d* of \d+|TOTAL: [1-9]\d* (?:SUCCESS|FAILED)|[1-9]\d* passing|Tests:\s+[1-9]\d*|^# tests [1-9]\d*|[1-9]\d* specs?, \d+ failures?|\b[1-9]\d*\s*(?:tests?|assertions?)\s+passed|# pass [1-9]\d*/m;
const SUITE_EMPTY = /^\s*(?:no tests ran|Executed 0 of 0|0 passing|Tests:\s+0|# tests 0|# pass 0)\b|(?<!\\)\[no test files\]/m;

/** 正数=跑了N个 · 0=空跑 · null=不是测试输出（不判定）。 */
export function countTestsRun(output) {
  if (typeof output !== "string" || !output) return null;
  if (SUITE_RAN.test(output)) return 1;
  if (SUITE_EMPTY.test(output)) return 0;
  return null;
}

// 结构性剥离（v0.2 定案 + v0.3 F11）：先剥结构再按句匹配。
// v0.3 F11：markdown 列表状态行（「- **项**：✅ 已落地」）是 UI JSON/表格/引号之外
// 的第 4 种结构形态（实测定案：session-91245193 turn 14 回答进度被状态行误拦）。
// 要求行含状态 emoji，避免误剥「- 结论：已修复并验证通过」这类正文列表声明。
function stripNonProse(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*[-*+]\s+[^\n]*[：:]\s*[✅❌⚠️☑✓✗]\s*(?:已|未)[^\n，。]{0,14}\s*$/gm, " ")  // F11
    .replace(/^\s*>.*$/gm, " ")
    .replace(/[「『"][^「」『』"]{0,40}[」』"]/g, " ")
    .replace(/`[^`]*`/g, " ");
}

// v0.3：按句切分（句读/换行/逗号）。句级判定让「A 没修好，B 已修复」不被整块豁免。
function sentencesOf(text) {
  return String(text || "")
    .split(/[。！？!?\n；;，,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

/** 单句内找完成声明。返回命中词或 null。track1 与 track2 各自守卫。 */
function findClaimIn(sentence) {
  // track1: 已X 形态（v0.2 词表，行为不变）
  const m1 = sentence.match(CLAIM_V02);
  if (m1) return m1[0];
  // track2: X完成 形态（F1），后缀守卫
  const m2 = sentence.match(DONE_ACTION);
  if (m2) {
    const full = m2[0];
    // 命中串后紧跟「后前中时再」→ 流程/过程描述，非完成声明
    if (DONE_SUFFIX_GUARD.test(sentence.slice(sentence.indexOf(full), sentence.indexOf(full) + full.length + 1))) return null;
    return full;
  }
  return null;
}

// 真实消息文本（assistant/user）。v0.2 定案结构 + 兼容裸 text/content。
function textOf(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  const m = data.message || data;
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((c) => c && c.type !== "reasoning")
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("");
  }
  return "";
}

/**
 * F8：tool/result 正文。v0.2 读 e.data.result —— 生产 0 命中（probe-result-shape：
 * 3487 条 tool/result 无 data.result；正文在 message.content[0].content[].text，
 * 或 content[0] 本身为文本块）。兼容夹具的 data.result 短路径。
 */
function resultBody(data) {
  if (!data) return "";
  const direct = data.result;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return JSON.stringify(direct);
  const m = data.message;
  if (!m) return "";
  const blocks = Array.isArray(m.content) ? m.content : [];
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.text === "string") out.push(b.text);
    else if (Array.isArray(b.content)) {
      for (const c of b.content) {
        if (c && typeof c.text === "string") out.push(c.text);
      }
    }
  }
  return out.join("\n");
}

/** 该 tool/result 是否失败：宿主失败标记或 isError。 */
function resultFailed(data) {
  if (!data) return false;
  const body = resultBody(data);
  if (EXIT_FAIL.test(body)) return true;
  const m = data.message;
  const blocks = Array.isArray(m && m.content) ? m.content : [];
  return blocks.some((b) => b && b.isError === true);
}

/**
 * 判定核心。
 * @param {Array} events - session.events
 * @param {number} turn
 * @returns {{verdict:"no-claim"|"ok"|"unverified", claim?:string, reason?:string, evidence?:string[]}}
 */
export function decide(events, turn) {
  const list = Array.isArray(events) ? events : [];
  const claims = [];
  const evidence = [];

  // ── F2 证据窗口：turn 区间制 ──
  // 实测（probe-turn-field，session-91245193）：① 用户消息出现在 turn/start(N) 之后，
  // 无 data.turn；② tool/result 延迟乱序回流（旧 turn 的 result 出现在新 turn 中途）——
  // 位置窗口不可靠，必须按 data.turn 归属。
  // 窗口起点 W = 最近一条「归属 turn ≤ 声明轮」的真实用户消息的归属 turn；
  // 窗口 = { e : e.data.turn ∈ [W, turn] }。无真实用户消息（历史回放）→ 单轮语义。
  let cur = -1, firstTurn = -1;
  const userMsgs = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || !e.data) continue;
    if (e.type === "turn/start" && typeof e.data.turn === "number") {
      cur = e.data.turn;
      if (firstTurn < 0) firstTurn = cur;
    } else if (e.type === "user/message") {
      const kind = e.data.source && e.data.source.kind;
      if (kind === "plugin" || kind === "skill-catalog" || kind === "system") continue;
      userMsgs.push({ i, turn: cur < 0 ? (firstTurn < 0 ? 1 : firstTurn) : cur });
    }
  }
  let W = -1;
  for (let k = userMsgs.length - 1; k >= 0; k--) {
    if (userMsgs[k].turn <= turn) { W = userMsgs[k].turn; break; }
  }
  const inWindow = (e) => {
    if (!e || !e.data) return false;
    const t = e.data.turn;
    if (typeof t !== "number") return false;
    if (t > turn) return false;                 // 本 turn 之后的事件不算
    if (W < 0) return t === turn;               // 无窗口 → 单轮语义（v0.2 兼容）
    return t >= W;                              // 窗口 = 最近用户消息的 turn 以来
  };

  // call/result 交替栈（F4/F10）：失败 result 弹出最近一次调用；
  // pwsh 内容型取证（F10：turn 36 实锤——下载抓取 17KB 结果不含 VERIFY_CMD 被误判）
  // 由 result 正文长度 ≥200 提升为证据（拒空/短输出，防表演验证）。
  // F12：空跑（vacuous）只判定「测试运行类工具」的输出——read/grep 的正文永远不可能是
  // 测试结果，却可能含空跑摘要字样（读到自己或别的源码时自指）。
  // 配对用 FIFO 未决队列（宿主按调用顺序回 result；批量连发不再错配成 lastCallName）。
  // 已知残余：延迟乱序回流的 result（F9）会错配到本 turn 队首——方向为漏报/轻错，可接受。
  let vacuous = false;
  const pending = [];

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || !e.data) continue;

    if (e.type === "assistant/message") {
      if (e.data.turn !== turn) continue;
      const text = stripNonProse(textOf(e.data));
      if (!text) continue;
      for (const sentence of sentencesOf(text)) {
        if (DENIAL.test(sentence)) continue;            // 报告失败不是声明
        if (THIRD_PARTY.test(sentence)) continue;       // 他方主体不算我的声明
        const word = findClaimIn(sentence);
        if (!word) continue;
        if (INLINE_EVIDENCE.test(sentence)) continue;   // 句内自带硬证据
        if (!claims.includes(word)) claims.push(word);
      }
    } else if (e.type === "tool/call" && inWindow(e, i)) {
      const name = e.data.name;
      if (name) {
        const args = JSON.stringify(e.data.arguments || e.data.args || "");
        const contentCheck = name === "pwsh" && !VERIFY_CMD.test(args);
        const testLike = name === "pwsh" && TEST_CMD.test(args);
        const pc = { name, contentCheck, testLike, evIdx: null };
        pending.push(pc);                              // FIFO 未决（宿主按调用序回 result）
        if (!NON_VERIFY_TOOL.test(name) && !contentCheck) {
          evidence.push(name);                         // 候选证据入栈（F12：内容型不进栈，等 result 裁决）
          pc.evIdx = evidence.length - 1;              // F13：记住自己的槽位（失败只撤销自己）
        }
      }
    } else if (e.type === "tool/result" && inWindow(e, i)) {
      const body = resultBody(e.data);
      const pc = pending.shift();                      // FIFO 配对；乱序迟到 result 会错配（F9，漏报方向）
      const callName = pc ? pc.name : "";
      // 空跑撤销：声称测试通过却跑了零个（F8 修复后此路径真实可达）。
      // F12：只判「测试运行命令」的输出——read/grep/调试命令正文含空跑摘要字样
      // 会自指误报（session-8d0d184b turn 4 实锤：read 自己源码 + 调试脚本打印触发词）。
      if (callName === "pwsh" && pc && pc.testLike && countTestsRun(body) === 0) vacuous = true;
      if (resultFailed(e.data)) {
        // F13（审计 cbbcd744 定案）：失败只撤销「本次调用自己 push 的证据」（evIdx 置空），
        // 不再 pop 栈顶——内容型 pwsh（call 时未入栈）失败时无权撤销同窗口内无关的真验证。
        // 置 null 而非 splice：索引稳定，输出端 filter(Boolean) 已清理。
        if (pc && pc.evIdx !== null && evidence[pc.evIdx] !== null) evidence[pc.evIdx] = null;
      } else if (pc && pc.contentCheck) {
        // 内容型 pwsh 成功且产出真实内容 → 证据（F10）；短输出（echo）不提升
        if (body.trim().length >= 200) evidence.push("pwsh:content");
      }
    }
  }

  const claimed = claims.length > 0 ? claims[0] : "";
  if (!claimed) return { verdict: "no-claim", evidence };
  const verified = evidence.some(Boolean);
  if (vacuous) return { verdict: "unverified", claim: claimed, reason: "vacuous", evidence };
  if (verified) {
    return {
      verdict: "ok",
      claim: claimed,
      reason: W >= 0 ? "window" : "same-turn",
      evidence: evidence.filter(Boolean),
    };
  }
  return { verdict: "unverified", claim: claimed, reason: "missing", evidence: evidence.filter(Boolean) };
}

export const name = "claim-gate";

// 本轮工具调用数。只为审计可解释性。
function countTools(events, turn) {
  let n = 0;
  for (const e of events) {
    if (e && e.type === "tool/call" && e.data && e.data.turn === turn) n++;
  }
  return n;
}

// 不 inject 任何服务：判定只用 payload 里的 agent.session.events，不碰 ctx.<service>
export function apply(ctx, config = {}) {
  const enforce = config.enforce === true;
  const auditHint = config.auditHint !== false;
  const logPath = config.logPath || join(homedir(), ".dsh", "state", "claim-gate.jsonl");
  const fired = new Set();

  ctx.on("agent/turn-stopping", ({ agent, turn }) => {
    const session = agent && agent.session;
    if (!session) return;
    const key = session.id + ":" + turn;
    if (fired.has(key)) return;

    let result;
    const t0 = Date.now();
    try {
      result = decide(session.events || [], turn);
    } catch (err) {
      audit(logPath, { time: new Date().toISOString(), error: String((err && err.message) || err) });
      return;
    }
    const ms = Date.now() - t0;

    audit(logPath, {
      time: new Date().toISOString(),
      session: session.id,
      turn,
      verdict: result.verdict,
      claim: result.claim,
      reason: result.reason,
      evidence: result.verdict === "ok" ? (result.evidence || []).slice(0, 8) : undefined,
      ms,                                     // v0.3：判定耗时（自检：serial 路径预算）
      enforce,
      tools: countTools(session.events || [], turn),
      enforced: enforce && result.verdict === "unverified"
    });
    if (result.verdict === "no-claim") return;

    if (enforce && result.verdict === "unverified") {
      fired.add(key);
      agent.steer(
        Object.freeze({
          role: "user",
          content: Object.freeze([
            Object.freeze({
              type: "text",
              text:
                "[claim-gate] 你这一轮说了「" +
                result.claim +
                (result.reason === "vacuous"
                  ? "」且声称跑过测试，但本轮没有测试真正运行（空跑不算验证）。"
                  : "」，但本轮没有任何验证类命令输出。按 AGENTS.md §0「已完成」铁律：改了文档/配置不等于改了代码。") +
                "先跑出能区分成功与失败的那一条命令（grep 到那行 / Test-Path / 测试变绿），再重述结论；" +
                "确实没做完就改口说清现状。\n" +
                "⚠️ 立刻 skill(\"dsh-karpathy-guidelines\")：把这个声明转成可验证目标，" +
                "验证通过才算完成；无法指认证据就明说「未验证」，不得包装成「已完成」。" +
                "若这是任务收尾或重要结论，再加 skill(\"dsh-verification\")做外部审计。"
            })
          ]),
          source: Object.freeze({ kind: "user" }),
          id: randomUUID()
        })
      );
    } else if (enforce && auditHint && result.verdict === "ok") {
      fired.add(key);
      const ev = (result.evidence || []).filter(Boolean).join("、") || "(无)";
      agent.steer(
        Object.freeze({
          role: "user",
          content: Object.freeze([
            Object.freeze({
              type: "text",
              text:
                "[claim-gate] 你这一轮说了「" +
                result.claim +
                "」，证据已核对存在（本轮/窗口内验证调用：" +
                ev.slice(0, 200) +
                "）。但「有验证输出」≠「验证真的覆盖了声明」——归因错误、计数错误、信息遗漏都会在自己的认知回路里通过自查。" +
                "请①用 skill(\"dsh-verification\")「结论对照验证器」逐条核对声明与证据是否一致；" +
                "②若证据来自窗口早段（本任务单元早些时候）而声明是最新进展，重点确认没有别的事项混入。" +
                "③若这是任务收尾或重要结论，派一个子智能体独立审计（dsh-verification §B），换一个 agent 重读同一份数据源。" +
                "核对通过才能把结论当定案。"
            })
          ]),
          source: Object.freeze({ kind: "user" }),
          id: randomUUID()
        })
      );
    }
  });
}

function audit(path, row) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, Buffer.from(JSON.stringify(row) + "\n", "utf8"));
  } catch {
    /* fail-safe */
  }
}
