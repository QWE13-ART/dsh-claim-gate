# dsh-claim-gate

[![Version](https://img.shields.io/github/v/tag/QWE13-ART/dsh-claim-gate?label=version&color=blue)](https://github.com/QWE13-ART/dsh-claim-gate)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)

dsh-claim-gate **stops unfounded "done" claims** the moment a coding agent signs off a turn. It mechanically checks the turn's tool evidence — zero LLM, pure regex, nothing for the agent to remember.

- **Claiming without evidence gets steered back to produce it.** Verdicts are structural facts from tool outputs, never the model's self-assessment (models cannot reliably audit their own work).
- **Rephrasing or relocating the claim does not hide it** — windowed turn tracking survives delayed, out-of-order tool results.
- **A broken config never blocks a turn** (fail-safe, not fail-closed); enforce mode was enabled only after real-corpus replay showed zero misfires.

[简体中文说明 ↓](#zh)

<a name="zh"></a>

## 为什么不是写规则

`cc-safety-net`（1,517⭐，GitHub API 2026-09-02 实查）README 原话：

> Rules in `CLAUDE.md` or `AGENTS.md` can guide an agent, but they **cannot enforce a technical limit**.

2026-08-31 本机实测印证：5 个反幻觉技能装齐，当天**一个都没触发**，4 个错本可各被拦一个。
执行者是 agent 的自觉，而自觉正是失灵的那个零件。

本插件挂宿主 `agent/turn-stopping`（serial，可 steer），**不问 agent 记不记得**。

## 判定

| 输入 | 结果 |
|---|---|
| 说了「已落地/已完成/已修复/已生效/调研完成…」+ 窗口内有验证输出 | `ok` — 放行，但 `auditHint:true` 时软提示：对照验证是否真覆盖声明 + 任务收尾派独立审计（治「以为验证对了其实错了」） |
| 说了声明 + 窗口内零验证输出 | `unverified` → 记录（`enforce:true` 时 steer 回去取证） |
| 没说声明 | `no-claim` 不干预 |

窗口 = 最近一条真实用户消息以来的轮次（v0.3 起，turn 区间制：按 `data.turn` 归属，
兼容宿主 tool/result 延迟乱序回流；无用户消息的历史回放 = 单轮语义）。
轮边界取宿主自己的 `turn/start` 事件，fork/resume 由宿主统一维护。

## 配置

```yml
- id: dsh-claim-gate
  plugin: dsh-claim-gate
  config:
    enforce: false   # 默认 observe-only：只记录不拦截
    auditHint: true  # ok(有验证)分支软提示：强制对照验证覆盖 + 任务收尾派独立审计（默认开）
```

审计落 `~/.dsh/state/claim-gate.jsonl`（含放行的，便于统计误报率）。
学 cc-safety-net：先用真实数据看误报率，再决定开 `enforce`。

## 设计取舍

- **fail-safe 而非 fail-closed**：插件自己出错 → 静默放过。漏判一次 = 一句话溜出去（用户能挑出来）；
  误拦一次 = 每轮都慢，用户会关掉它 —— 那才是彻底失效。
- **纯同步正则**：`turn-stopping` 是 serial，挡在关闭边界上。绝不在此发网络请求或跑子智能体。
- 同一轮最多 steer 一次，防死循环。

## 测试

```
node --test (Get-ChildItem test -Filter '*.test.js' | % FullName)   # 60/60（decide 基线 + vacuous + enforce + recall 矩阵 + 真实语料回归）
node test/replay.mjs                 # 真实会话回放审计
node test/compare-v03.mjs            # v0.2 vs v0.3 真实语料对照（合入门禁）
node --test test/enforce.test.js     # apply + steer 行为（enforce 拦截路径）
```

ponytail: 声明识别是正则，不做语义判断——语义要调模型，会拖死每一轮；误报率高到不可用时再考虑。

## Changelog

### v0.3.0（2026-09-02）

窗口与取证重写（详见 `docs/v0.3-design.md`，F1–F13 全定案）：

- **窗口 turn 区间制**：按 `data.turn` 归属事件，兼容宿主 tool/result 延迟乱序回流（F9）；无用户消息的回放 = 单轮语义
- **失败撤销按槽位**：每个调用只撤销自己 push 的证据，内容型 pwsh 失败不再误伤同窗口无关的真验证（F13，独立审计定案）
- **空跑三层检测**：计数形态行首锚定 + FIFO call/result 配对 + 只判测试运行命令输出（F12，修掉自指误报）
- **内容型 pwsh 取证**：≥200 字符真实输出提升为证据（F10）；markdown 列表状态行剥离（F11）
- 测试 60/60（decide 10 + vacuous 8 + enforce 7 + real-corpus 11 + recall 24）
- 真实语料对照（433 轮）：353 一致 / 2 已知边界（窗口切分拦截，可补证恢复）/ 0 漏抓
- 审计证据索引 `docs/v0.3-audit-evidence.md`（独立审计 7/7 复跑 + F13 修复闭环）
