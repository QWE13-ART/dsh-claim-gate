// 预检自检：把我犯过的三类错各造一个假插件，预检必须全部抓住。
// 不做这一步就无法排除「预检本身是假绿灯」——三次事故都是这么来的。
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const CORDIS = "file:///E:/DeepSeek%20Harness/DeepSeek%20Harness%20Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/cordis/lib/index.js";
const { Context } = await import(CORDIS);

const cases = [
  {
    name: "坑②ctx.config（真实事故：整树回退 builtins）",
    code: 'export function apply(ctx){const c=ctx.config||{};}\n',
    expect: "throw"
  },
  {
    name: "坑③inject 声明了不存在的服务（静默不加载）",
    code: 'export const inject=["nonexistent_svc_xyz"];\nexport function apply(ctx){}\n',
    expect: "state!=2"
  },
  {
    name: "错误 inject 对象形式 {required:[],optional:[]}",
    code: 'export const inject={required:["a"],optional:["b"]};\nexport function apply(ctx){}\n',
    expect: "state!=2"
  },
  {
    name: "对照组：正确的最小插件（必须通过）",
    code: 'export function apply(ctx){ctx.on("agent/turn-stopping",()=>{});}\n',
    expect: "pass"
  }
];

let bad = 0;
for (const [i, c] of cases.entries()) {
  const p = join(tmpdir(), `preflight-selftest-${i}.mjs`);
  writeFileSync(p, c.code);
  let verdict;
  try {
    const mod = await import(pathToFileURL(p).href);
    const root = new Context();
    const fiber = root.plugin(mod.default ?? mod, {});
    await fiber;
    verdict = fiber.state === 2 ? "pass" : "state!=2";
  } catch (e) {
    verdict = "throw";
  }
  const hit = verdict === c.expect;
  if (!hit) bad++;
  console.log(`  ${hit ? "OK  " : "FAIL"} ${c.name}`);
  console.log(`       期望 ${c.expect} / 实得 ${verdict}`);
  unlinkSync(p);
}
console.log(bad === 0 ? "\n预检自检：4/4 通过，预检有效" : `\n预检自检：${bad} 项失败，预检不可信`);
if (bad) process.exitCode = 1;
