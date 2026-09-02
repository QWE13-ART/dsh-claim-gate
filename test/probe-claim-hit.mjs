// probe-claim-hit.mjs — 找出 decide 在指定 turn 命中的声明句（人工定案用）
// 用法: node test/probe-claim-hit.mjs <sid 片段> <turn>
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const [sid, turnArg] = process.argv.slice(2);
const turn = Number(turnArg);
const ROOT = join(homedir(), ".dsh", "sessions");
function walk(d, o = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p);
  }
  return o;
}
import { readdirSync } from "node:fs";
const file = walk(ROOT).find((x) => x.includes(sid));
const buf = readFileSync(file);
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const s = []; let i = 0;
while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
const parts = [];
for (let k = 0; k < s.length; k++) {
  try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
}
const evs = [];
for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }

for (const e of evs) {
  if (e.type !== "assistant/message" || !e.data || e.data.turn !== turn) continue;
  const m = e.data.message || e.data;
  let txt = Array.isArray(m.content)
    ? m.content.filter((c) => c && c.type !== "reasoning").map((c) => c.text || "").join("")
    : (typeof m.text === "string" ? m.text : "");
  const stripped = txt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/[「『"][^「」『』"]{0,40}[」』"]/g, " ")
    .replace(/`[^`]*`/g, " ");
  const sents = stripped.split(/[。！？!?\n；;，,]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
  for (const st of sents) {
    if (/(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/.test(st)) {
      console.log(`命中句(track1): ${JSON.stringify(st.slice(0, 200))}`);
    } else if (/(调研|接入|安装|部署|迁移|重构|落地|修复|实施|导出|导入|备份|恢复|合并|提交|推送|拉取|扫描|审计|清理|删除|创建|生成|配置|升级|降级|编译|构建|测试|验证|整合|拆分|撰写|修改|调整)(完成|完毕)/.test(st)) {
      console.log(`命中句(track2): ${JSON.stringify(st.slice(0, 200))}`);
    }
  }
  if (sents.length) console.log(`（该消息 ${sents.length} 句，总长 ${txt.length}）`);
}
