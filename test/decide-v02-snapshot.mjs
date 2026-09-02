import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

// 句内自带硬证据 = 已经取证了，不该再拦。
// 回放实证：误报里 2 条的共同特征是声明句就带了证据「87/87 绿」「83/83 测试背书」。
// ⚠️ 必须写窄：第一版写了 `\d+\s*个?(测试|条|处)` 和裸 `\d+/\d+`，把 turn 112
// 「全部 9 个索引…全部通过」也放行了 —— 那是真阳。降误报不能降到把检测器关掉。
// 只认「N/N」同数比分（测试全绿的固定形态）与 file:line、exit 0。
const INLINE_EVIDENCE = /((\d+)\/\2\b|:\d+(-\d+)?\b|\bexit\s*(code)?\s*[=:]?\s*0\b|EXIT=0)/;

// 他方主体：说的是子智能体/用户/文档完成了什么，不是我的产物。
// 回放实证：turn 105「调研已完成」指子智能体的调研、turn 168「两轴独立发现」指审查子智能体。
// ⚠️ 不含「调研」以外的泛词，否则我自己说「审查完了」也会被放行。
const THIRD_PARTY = /(子智能体|子代理|调研|审查轴|两轴|用户说|你说|报告说)/;

// 「已完成」类声明：治的是今天最贵的错（"6 个借鉴点已落地" 实际 1 个）
const CLAIM = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/;

// 验证类证据：能区分成功失败的工具调用。
// ⚠️ 2026-08-31 全库回放暴露的真实缺陷：原白名单只有 6 个内置工具名，把大量真正的
// 验证手段排除在外 → 真实误报 4/6。实测被误判的两轮：
//   · turn 11 跑了 5 次 cordis_inspect_query（查 Slot 实际占位）→ 被判"未验证"
//   · turn 24 跑了 git_show 拿到 schema diff + serena 查引用 → 被判"未验证"
// 判据不该是「工具是否内置」，而是「这次调用能不能区分成功与失败」。
// 所以扩到：查询宿主真实状态（cordis_inspect_*）· 读真实仓库（git_*）· 符号级导航
// （serena / codegraph）· 契约核验（tools_schema）。这些全部返回可判真伪的事实。
//
// 🔴 第二轮修正（turn 97 定性）：白名单永远追不上真实工具集。turn 97 用
// tools_status 查 assemble 轮次、真调 mcp__reasonix__get_config / ssh_list 三次
// 证伪了自己的设计预期、跑 pwsh+Python 做算术闭合——六个观察点逐条实测，
// 却因这些名字都不在白名单、且 pwsh 的 command 是 Python 脚本没命中 VERIFY_CMD
// 而被判"未验证"。根因是白名单这个形式本身：我不可能穷举 363 个工具里哪些算验证。
// → 改成「否定式判据」：绝大多数工具调用都会返回可判真伪的事实，
//   真正不构成证据的是少数几类（纯写入待办、纯展示、纯询问、纯记忆写入）。
//   列黑名单可穷举，列白名单不可穷举。
const NON_VERIFY_TOOL = /^(todo_write|render_ui|validate_dsh_ui|ask_user_question|dsh_show_media|dsh_im_return_file|mem_save_prompt|lesson_save|prompt_optimize|create_goal|update_goal)$/;
const VERIFY_CMD = /(grep|Select-String|Test-Path|ReadAllText|ReadAllBytes|npm test|node --test|node --check|\.Contains\()/;

// 否认句式：说「没修好 / 依然复现 / 还是失败」是在报告失败，不是在声称完成。
// 实测 turn 23 原文「integer 问题**没修好**,依然复现」被判 unverified —— 纯误报，
// 我在如实汇报一个未解决的问题，护栏却把它当成虚假声明。
const DENIAL = /(没修好|没有修好|未修好|依然复现|仍然复现|还是失败|仍然失败|没成功|未解决|仍未|没生效|未生效)/;

// 空跑检测（vacuous pass）：移植 SWE-bench/SWE-bench（5750⭐）swebench/harness/grading.py L32-40。
// 已 raw.githubusercontent 逐字核验：每个计数都写成 [1-9]\d*，所以 "Executed 0 of 0"、"0 passing"
// 不构成证据。这治的是「exit 0 但一个测试都没跑」——本机教训「exit 0 ≠ 做成了」的反向用法。
// 三档返回：正数=真跑了 / 0=声称是测试但跑了零个 / null=这段输出压根不是测试摘要（lint/build/grep）。
// null 分支必须留：否则 grep 输出会被误判成「0 个测试」，把正常验证打成假绿灯。
const SUITE_RAN = /Executed [1-9]\d* of \d+|TOTAL: [1-9]\d* (?:SUCCESS|FAILED)|[1-9]\d* passing|Tests:\s+[1-9]\d*|^# tests [1-9]\d*|[1-9]\d* specs?, \d+ failures?|\b[1-9]\d*\s*(?:tests?|assertions?)\s+passed|# pass [1-9]\d*/m;
const SUITE_EMPTY = /no tests ran|\[no test files\]|Executed 0 of 0|\b0 passing\b|Tests:\s+0\b|# tests 0\b|# pass 0\b/;

/** 正数=跑了N个 · 0=空跑 · null=不是测试输出（不判定）。ponytail: 纯正则，无 AST 无异步 */
export function countTestsRun(output) {
  if (typeof output !== "string" || !output) return null;
  if (SUITE_RAN.test(output)) return 1;   // 只需知道「跑了>0个」，不需要精确条数
  if (SUITE_EMPTY.test(output)) return 0;
  return null;                            // 没有测试摘要 → 不是空跑，是别的东西
}

// 结构性剥离：回放 4 个真实会话、人工核对 10 条命中，9 条是「声明词出现在数据结构里而非句子里」。
// 分布：UI 组件 JSON 状态标记 4 条（"desc":"✅ 已完成"）· markdown 表格单元格 3 条（| ✅ 已完成 |）
// · 引用复述 2 条（"6 个借鉴点已落地"（实际 1 个））。只有 1 条是真声明。
// 所以先剥离这些结构再匹配，比在关键词上做否定词窗口更省也更准（ponytail: 删输入而非加规则）。
function stripNonProse(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")        // 代码块 / dsh-ui 围栏（UI 状态标记都在这里）
    .replace(/^\s*\|.*\|\s*$/gm, " ")       // markdown 表格行（整行剥掉）
    .replace(/^\s*>.*$/gm, " ")             // 引用块
    .replace(/[「『"][^「」『』"]{0,40}[」』"]/g, " ") // 短引号内容：引用他人/自己的原话
    .replace(/`[^`]*`/g, " ");              // 行内 code
}

// ponytail: 纯正则同步判定，turn-stopping 是 serial 不能阻塞；要语义判断就得调模型，那会拖死每一轮
// 轮边界用宿主自己的 turn/start 事件（比外部记 seq 可靠：fork/resume 都由宿主统一维护）
export function decide(events, turn) {
  let claimed = "";
  let verified = false;
  let vacuous = false;   // 本轮出现过「声称是测试却跑了零个」的输出

  // 只看 data.turn === turn 的事件。
  // 早期版本从 turn/start 索引扫到数组末尾、没有轮次终点边界，回放历史数据时
  // 把后续所有轮的工具调用都算成"本轮证据"→ 457 轮全判 ok（跨轮污染）。
  // 真实事件的 data.turn 自带归属，直接过滤比找终点索引更短也更准。
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || !e.data || e.data.turn !== turn) continue;
    if (e.type === "assistant/message") {
      const text = stripNonProse(textOf(e.data));
      const m = text && text.match(CLAIM);
      if (m) {
        // 句内自带证据（N/N 绿 / file:line / exit 0）→ 已经取证了，放行
        if (INLINE_EVIDENCE.test(text)) { verified = true; continue; }
        // 他方主体（子智能体/调研/用户说）→ 不是我的声明，不拦
        if (THIRD_PARTY.test(text)) continue;
        // 否认句式 → 我在报告失败，不是声称完成（turn 23「没修好,依然复现」实测误报）
        if (DENIAL.test(text)) continue;
        claimed = m[1];
      }
    } else if (e.type === "tool/call") {
      const name = e.data.name;
      if (name && !NON_VERIFY_TOOL.test(name)) {
        const args = JSON.stringify(e.data.arguments || e.data.args || "");
        // pwsh 仍要看命令内容：跑个 echo 不算验证。其余工具本身就返回真实事实。
        if (name !== "pwsh" || VERIFY_CMD.test(args)) verified = true;
      }
    } else if (e.type === "tool/result") {
      // 空跑撤销：证据的「有」不等于证据的「真」。exit 0 + 零测试 = 假绿灯。
      // 只在 countTestsRun 明确返回 0 时撤销；null（非测试输出）绝不动 verified。
      const r = e.data.result;
      const text = typeof r === "string" ? r : (r ? JSON.stringify(r) : "");
      if (countTestsRun(text) === 0) vacuous = true;
    }
  }

  if (!claimed) return { verdict: "no-claim" };
  // 空跑优先于 verified：跑过测试但零个通过，等于没验证（SWE-bench 的 vacuous pass）
  if (vacuous) return { verdict: "unverified", claim: claimed, reason: "vacuous" };
  if (verified) return { verdict: "ok", claim: claimed };
  return { verdict: "unverified", claim: claimed, reason: "missing" };
}

// 真实落盘结构（回放 9935 条实测）：assistant/message 的文本在
//   data.message.content[] = [{type:"reasoning",text}, {type:"text",text}, ...]
// 早期版本只读 data.text / data.content[]，少了 .message 一层 → 生产里永远拿到空串
// → 永远判 no-claim。这个 bug 靠单测发现不了，只有回放真实会话才暴露。
// 另：type:"reasoning" 是思考过程，不是对外声明，必须排除（否则"我在想是不是已完成"也算）。
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

export const name = "claim-gate";

// 本轮工具调用数。只为审计可解释性：turn-stopping 的派发条件是
// `turnEnds && inbox.nextStep.length === 0`（dsh-agent-loop L564），
// 工具密集的长轮次可能压根不发这个事件——记下这个数才能看出闸门在哪种轮次上真正生效。
function countTools(events, turn) {
  let n = 0;
  for (const e of events) {
    if (e && e.type === "tool/call" && e.data && e.data.turn === turn) n++;
  }
  return n;
}
// 不 inject 任何服务：判定只用 payload 里的 agent.session.events，不碰 ctx.<service>
// config 是 apply 的第二参（cordis lib/index.js L1070: runtime.callback(this.ctx, this.config)），
// 不是 ctx.config——后者会撞 ReflectService 兜底 trap 抛 "cannot get property without inject"
export function apply(ctx, config = {}) {
  const enforce = config.enforce === true; // v1 默认 observe-only
  const auditHint = config.auditHint !== false; // ok(有验证)分支软提示：强制对照验证覆盖 + 任务收尾派审计，默认开
  const logPath = config.logPath || join(homedir(), ".dsh", "state", "claim-gate.jsonl");
  const fired = new Set();

  ctx.on("agent/turn-stopping", ({ agent, turn }) => {
    const session = agent && agent.session;
    if (!session) return;
    const key = session.id + ":" + turn;
    if (fired.has(key)) return; // 同一轮只拦一次，防死循环

    let result;
    try {
      result = decide(session.events || [], turn);
    } catch (err) {
      audit(logPath, { time: new Date().toISOString(), error: String((err && err.message) || err) });
      return; // fail-safe：插件自己坏了绝不影响对话
    }

    // no-claim 也要落一条。原来这里直接 return，导致「日志为空」有两种成因
    // （hook 没触发 / 每轮都判 no-claim）却只有一种现象——2026-08-31 我因此
    // 连续误判四次「hook 没工作」。记了结论不记依据，等于没记。
    audit(logPath, {
      time: new Date().toISOString(),
      session: session.id,
      turn,
      verdict: result.verdict,
      claim: result.claim,
      enforce, // 开关自身的值：判断「enforce 到底读到没有」的唯一直接证据
      tools: countTools(session.events || [], turn), // 本轮工具调用数：看闸门装在什么形态的轮次上
      enforced: enforce && result.verdict === "unverified"
    });
    if (result.verdict === "no-claim") return;

    if (enforce && result.verdict === "unverified") {
      fired.add(key);
      // steer 的消息结构（权威源：dsh-plan-mode L245-251 唯一调用点 + dsh-llm L157-181）：
      //   { role:"user", content:[{type:"text",text}], source:{kind:"user"}, id }
      // 官方 createUserMessage 做三件事：补 role、补 id、deepFreeze(structuredClone())。
      // 实测 MessageId(id) 是 `return id`（纯类型标记，运行时 no-op），所以这里零依赖自造——
      // 硬 import @deepseek-ai/dsh-llm 会 ERR_MODULE_NOT_FOUND（本插件无 node_modules），
      // 那正是 §7 那类"整棵树回退 builtins"的事故。
      // ⚠️ 我原先写的 { role:"user", content:"裸字符串" } 缺 id/缺 source/content 类型也错。
      // observe-only 模式永不执行这一行，所以这个 bug 藏到了开 enforce 的这一刻。
      agent.steer(
        Object.freeze({
          role: "user",
          content: Object.freeze([
            Object.freeze({
              type: "text",
              text:
                "[claim-gate] 你这一轮说了「" +
                result.claim +
                "」，但本轮没有任何验证类命令输出。按 AGENTS.md §0「已完成」铁律：改了文档/配置不等于改了代码。" +
                "先跑出能区分成功与失败的那一条命令（grep 到那行 / Test-Path / 测试变绿），再重述结论；" +
                "确实没做完就改口说清现状。\n" +
                // 2026-08-31 补：光讲道理不给工具，执行者还是我的判断力。这里点名两个技能，
                // 把"该怎么做"变成一条可执行动作。实测本机 5 个反幻觉技能整会话 0 次触发，
                // 根因是触发依赖我的自觉——由宿主在拦截时点名，才不依赖自觉。
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
      agent.steer(
        Object.freeze({
          role: "user",
          content: Object.freeze([
            Object.freeze({
              type: "text",
              text:
                "[claim-gate] 你这一轮说了「" +
                result.claim +
                "」并附了验证，但「有验证输出」≠「验证真的覆盖了声明」——归因错误、计数错误、信息遗漏都会在自己的认知回路里通过自查。" +
                "请①用 skill(\"dsh-verification\")「结论对照验证器」逐条核对声明与证据是否一致；" +
                "②若这是任务收尾或重要结论，派一个子智能体独立审计（dsh-verification §B），换一个 agent 重读同一份数据源。" +
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
