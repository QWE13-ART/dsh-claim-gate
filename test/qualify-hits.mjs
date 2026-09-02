// 逐条定性：抽 3 个触发轮，看那个"可疑数字"在文本里的真实语境。
// 这一步不能省 —— 判据说"可疑"，我要看它到底可疑不可疑。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");
function find(d, o = []) {
  let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const e of es) { const p = join(d, e.name);
    if (e.isDirectory()) find(p, o); else if (e.name.endsWith(".jsonl.zstd")) o.push(p); }
  return o;
}
function load(f) {
  const buf = readFileSync(f), M = Buffer.from([0x28,0xb5,0x2f,0xfd]);
  const s = []; let i = 0;
  while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < s.length; k++) {
    try { parts.push(zstdDecompressSync(buf.subarray(s[k], k+1<s.length?s[k+1]:buf.length))); } catch {}
  }
  const evs = [];
  for (const l of Buffer.concat(parts).toString("utf8").split("\n")) if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} }
  return evs;
}
// 三个代表：本会话 turn 61（2036/50883）、turn 67（821/126/111/466）、某轮 331012528
const WANT = [
  { key: "aa5ede27", turn: 61, nums: ["2036", "50883"] },
  { key: "aa5ede27", turn: 67, nums: ["821", "126", "111", "466"] },
];
for (const w of WANT) {
  const f = find(ROOT).find((x) => x.includes(w.key));
  if (!f) { console.log("未找到会话 " + w.key); continue; }
  const evs = load(f);
  const texts = [];
  for (const e of evs) {
    if (e.type === "assistant/message" && e.data && e.data.turn === w.turn) {
      const d = e.data.message || e.data;
      if (Array.isArray(d.content)) for (const c of d.content) if (c && c.type === "text" && c.text) texts.push(c.text);
    }
  }
  const txt = texts.join("\n");
  console.log("\n========== turn " + w.turn + " ==========");
  for (const n of w.nums) {
    const idx = txt.replace(/,/g, "").indexOf(n);
    // 在原文里找带逗号或不带逗号的形态
    let at = txt.indexOf(n);
    if (at < 0) { const c = n.length > 3 ? n.slice(0,-3) + "," + n.slice(-3) : n; at = txt.indexOf(c); }
    if (at < 0) { console.log("  [" + n + "] 原文未直接出现（可能被逗号或百分号切分）"); continue; }
    console.log("  [" + n + "] 语境: ..." + txt.slice(Math.max(0,at-90), at+70).replace(/\s+/g," ") + "...");
  }
}
