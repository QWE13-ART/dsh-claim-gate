// enforce:true 路径的专项测试。
// 为什么必须单独测：observe-only 模式下 agent.steer(...) 那一行永不执行，
// 所以「steer 的消息结构写错」这个 bug 能一直藏到开 enforce 的那一刻。
// 实测已抓到一个：我原先传 { role:"user", content:"裸字符串" }，
// 而真实契约是 { role, content:[{type:"text",text}], source:{kind:"user"}, id }。
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync, readFileSync } from "node:fs";

// 最小 ctx：只需要 on() 收下 handler
function fakeCtx() {
  const handlers = {};
  return {
    ctx: { on: (event, fn) => { handlers[event] = fn; return () => {}; } },
    fire: (payload) => handlers["agent/turn-stopping"](payload)
  };
}

const mkClaim = (turn, text) => ({
  type: "assistant/message",
  data: { turn, message: { role: "assistant", content: [{ type: "text", text }] } }
});
const mkStart = (turn) => ({ type: "turn/start", data: { turn } });
const mkTool = (turn, name, cmd) => ({
  type: "tool/call", data: { turn, name, arguments: JSON.stringify({ command: cmd }) }
});

function run(events, turn, config) {
  const logPath = join(tmpdir(), "cg-enforce-" + randomSuffix() + ".jsonl");
  const steered = [];
  const { ctx, fire } = fakeCtx();
  apply(ctx, { ...config, logPath });
  fire({
    agent: { session: { id: "s1", events }, steer: (m) => steered.push(m) },
    turn
  });
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  try { rmSync(logPath, { force: true }); } catch {}
  return { steered, log };
}
function randomSuffix() { return Math.random().toString(36).slice(2, 8); }

test("enforce:true + unverified → 真的调了 steer", () => {
  const events = [mkStart(1), mkClaim(1, "改完了，已落地")];
  const { steered } = run(events, 1, { enforce: true });
  assert.equal(steered.length, 1, "应当 steer 一次");
});

test("steer 的消息结构符合宿主契约", () => {
  const events = [mkStart(1), mkClaim(1, "已落地")];
  const { steered } = run(events, 1, { enforce: true });
  const m = steered[0];
  // 权威源：dsh-plan-mode L245-251（唯一调用点）+ dsh-llm L157-181（createUserMessage）
  assert.equal(m.role, "user", "role 必须是 user");
  assert.ok(Array.isArray(m.content), "content 必须是数组，不是裸字符串");
  assert.equal(m.content[0].type, "text");
  assert.ok(m.content[0].text.includes("已落地"), "提示里要带上命中的那个词");
  assert.deepEqual(m.source, { kind: "user" }, "source.kind 必须是 user");
  assert.ok(typeof m.id === "string" && m.id.length > 0, "必须有 id");
  assert.ok(Object.isFrozen(m), "官方 createMessage 会 deepFreeze");
});

test("enforce:false（observe-only）→ 只写日志不 steer", () => {
  const events = [mkStart(1), mkClaim(1, "已落地")];
  const { steered, log } = run(events, 1, { enforce: false });
  assert.equal(steered.length, 0, "观察模式不该干预");
  assert.ok(log.includes("unverified"), "但要留审计记录");
});

test("审计日志自证：记 enforce 自身的值 + 本轮工具数 + no-claim 也要落盘", () => {
  // 2026-08-31 的教训：原来 no-claim 直接 return 不写日志，导致「日志为空」
  // 既可能是 hook 没触发、也可能是每轮都判 no-claim——两种成因一个现象，
  // 我因此连续误判四次。审计必须能自证，记结论不记依据等于没记。
  const noClaim = run([mkStart(1), mkClaim(1, "我看了一下")], 1, { enforce: true });
  const row = JSON.parse(noClaim.log.trim().split("\n").pop());
  assert.equal(row.verdict, "no-claim", "no-claim 也必须落一条");
  assert.equal(row.enforce, true, "必须记开关自身的值，这是判断 enforce 读到没有的唯一直接证据");
  assert.equal(typeof row.tools, "number", "必须记本轮工具调用数");

  // 工具数要真的数对：turn-stopping 派发条件含 inbox.nextStep 为空
  // （dsh-agent-loop L564），工具密集轮次可能压根不发事件，这个数才能解释现象
  const withTools = run(
    [mkStart(1), mkTool(1, "pwsh", "Test-Path E:\\a"), mkTool(1, "read", ""), mkClaim(1, "看完了")],
    1,
    { enforce: true }
  );
  const r2 = JSON.parse(withTools.log.trim().split("\n").pop());
  assert.equal(r2.tools, 2, "本轮两次 tool/call 就要记 2");

  // enforce:false 时该字段如实为 false，不是省略
  const off = run([mkStart(1), mkClaim(1, "我看了一下")], 1, { enforce: false });
  assert.equal(JSON.parse(off.log.trim().split("\n").pop()).enforce, false);
});

test("同一轮只 steer 一次（防死循环）", () => {
  const events = [mkStart(1), mkClaim(1, "已落地")];
  const logPath = join(tmpdir(), "cg-once-" + randomSuffix() + ".jsonl");
  const steered = [];
  const { ctx, fire } = fakeCtx();
  apply(ctx, { enforce: true, logPath });
  const payload = {
    agent: { session: { id: "s1", events }, steer: (m) => steered.push(m) },
    turn: 1
  };
  fire(payload);
  fire(payload); // 被 steer 唤起后会再次收尾，这一次必须放行
  try { rmSync(logPath, { force: true }); } catch {}
  assert.equal(steered.length, 1, "第二次收尾不该再拦，否则死循环");
});

test("ok 软提示（auditHint 默认开）+ auditHint:false 关闭 + no-claim 不 steer", () => {
  // ok（有验证的完成声明）：enforce + auditHint 默认 → 软提示一次（对照验证覆盖 + 派审计）
  const ok = run([mkStart(1), mkTool(1, "pwsh", "Test-Path E:\\x"), mkClaim(1, "已落地")], 1, { enforce: true });
  assert.equal(ok.steered.length, 1, "ok 时默认软提示一次");
  assert.ok(ok.steered[0].content[0].text.includes("dsh-verification"), "软提示要点名验证对照/审计");

  // auditHint:false → 关闭软提示，ok 不 steer
  const okOff = run([mkStart(1), mkTool(1, "pwsh", "Test-Path E:\\x"), mkClaim(1, "已落地")], 1, { enforce: true, auditHint: false });
  assert.equal(okOff.steered.length, 0, "auditHint:false 时 ok 不 steer");

  // enforce:false 观察模式：ok 也不干预（软提示受主开关门控）
  const okObserve = run([mkStart(1), mkTool(1, "pwsh", "Test-Path E:\\x"), mkClaim(1, "已落地")], 1, { enforce: false });
  assert.equal(okObserve.steered.length, 0, "观察模式 ok 不干预");

  // no-claim：不声明就不 steer
  const none = run([mkStart(1), mkClaim(1, "我看了一下")], 1, { enforce: true });
  assert.equal(none.steered.length, 0, "没声明不该拦");
});

test("session 缺失时不崩（fail-safe）", () => {
  const { ctx, fire } = fakeCtx();
  apply(ctx, { enforce: true, logPath: join(tmpdir(), "cg-nil.jsonl") });
  assert.doesNotThrow(() => fire({ agent: {}, turn: 1 }));
});
