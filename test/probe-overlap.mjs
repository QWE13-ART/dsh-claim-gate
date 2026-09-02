// 可行性探针：标识符重叠能否区分「验证了A却声称B」？
// 这是当前约束（纯同步 JS / 无 GPU / 无网络 / 毫秒级）下唯一可能的相关性检查路线。
//
// 思路：从声明句抽出代码标识符（文件名/函数名/符号），与本轮工具调用的
// 参数+输出做交集。交集为空 → 「验证的东西和声称的东西无关」。
//
// 本探针只回答一个问题：真实会话数据里，这个信号的信噪比够不够用？
// 不够就说不够——不预设结论。
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

// 代码标识符：驼峰/蛇形/带扩展名的文件/带点的路径/反引号内容
const IDENT = /`([^`]{2,60})`|\b([a-z][a-zA-Z0-9]{2,}[A-Z][a-zA-Z0-9]*)\b|\b([a-z_][a-z0-9_]{2,}\.(js|mjs|ts|json|yml|md))\b|\b([A-Z_]{3,})\b/g;

function identsOf(text) {
  const out = new Set();
  let m;
  IDENT.lastIndex = 0;
  while ((m = IDENT.exec(text)) !== null) {
    const v = m[1] || m[2] || m[3] || m[4];
    if (v) out.add(v.toLowerCase());
  }
  return out;
}

function loadEvents(file) {
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let i = 0;
  while (i < buf.length) {
    const at = buf.indexOf(MAGIC, i);
    if (at < 0) break;
    starts.push(at);
    i = at + 4;
  }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], end))); } catch {}
  }
  const evs = [];
  for (const line of Buffer.concat(parts).toString("utf8").split("\n")) {
    if (line.trim()) { try { evs.push(JSON.parse(line)); } catch {} }
  }
  return evs;
}

const CLAIM = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/;

const file = process.argv[2];
const events = loadEvents(file);

// 按轮次分组
const turns = new Map();
for (const e of events) {
  const t = e.data && e.data.turn;
  if (typeof t !== "number") continue;
  if (!turns.has(t)) turns.set(t, []);
  turns.get(t).push(e);
}

let claimTurns = 0, bothHave = 0, overlapZero = 0, overlapPos = 0;
const samples = [];

for (const [turn, evs] of [...turns.entries()].sort((a, b) => a[0] - b[0])) {
  // 声明句：assistant 文本里含声明词的句子
  let claimText = "";
  for (const e of evs) {
    if (e.type !== "assistant/message") continue;
    const d = e.data && (e.data.message || e.data);
    const content = d && d.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c && c.type === "text" && typeof c.text === "string" && CLAIM.test(c.text)) {
        // 只取含声明词的那些句子，不是整段
        for (const sent of c.text.split(/[。\n！]/)) {
          if (CLAIM.test(sent)) claimText += sent + " ";
        }
      }
    }
  }
  if (!claimText) continue;
  claimTurns++;

  // 证据侧：本轮所有 tool/call 的参数 + tool/result 的输出
  let evidText = "";
  for (const e of evs) {
    if (e.type === "tool/call") {
      const a = e.data && e.data.arguments;
      if (typeof a === "string") evidText += a + " ";
      else if (a) evidText += JSON.stringify(a) + " ";
    } else if (e.type === "tool/result") {
      const r = e.data && e.data.result;
      if (typeof r === "string") evidText += r.slice(0, 4000) + " ";
      else if (r) evidText += JSON.stringify(r).slice(0, 4000) + " ";
    }
  }

  const ci = identsOf(claimText);
  const ei = identsOf(evidText);
  if (ci.size === 0) continue; // 声明句没有可锚定的标识符——这本身是个重要发现
  bothHave++;

  const inter = [...ci].filter((x) => ei.has(x));
  if (inter.length === 0) overlapZero++;
  else overlapPos++;

  if (samples.length < 12) {
    samples.push({
      turn,
      claim: claimText.trim().slice(0, 90),
      claimIdents: [...ci].slice(0, 6),
      overlap: inter.slice(0, 6),
    });
  }
}

console.log("=== 标识符重叠信号的可行性 ===");
console.log("  含声明词的轮次      : " + claimTurns);
console.log("  声明句里有标识符的  : " + bothHave + (claimTurns ? "  (" + Math.round(bothHave / claimTurns * 100) + "%)" : ""));
console.log("  ├ 重叠为空(判不相关): " + overlapZero);
console.log("  └ 有重叠(判相关)    : " + overlapPos);
console.log("");
console.log("=== 样本（人工判断这个信号靠不靠谱）===");
for (const s of samples) {
  console.log("  turn " + s.turn + "  重叠=" + (s.overlap.length ? s.overlap.join(",") : "【空】"));
  console.log("    声明: " + s.claim);
  console.log("    声明标识符: " + s.claimIdents.join(", "));
}
