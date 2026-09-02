// 从真实会话导出指定轮次的最小事件切片，供回归测试当夹具用。
// 为什么要导出而不是在测试里读会话文件：会话文件会被压缩/轮转/清理，
// 测试依赖它就等于测试会随时变红。夹具落成常量才是可复现的回归防线。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");

function findSessions(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findSessions(p, out);
    else if (e.name.endsWith(".jsonl.zstd")) out.push(p);
  }
  return out;
}

function loadEvents(file) {
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let i = 0;
  while (i < buf.length) { const at = buf.indexOf(MAGIC, i); if (at < 0) break; starts.push(at); i = at + 4; }
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

// 目标：找出 decide() 判 unverified 的轮次，导出其最小切片
const CLAIM = /(已落地|已完成|已修好|已修复|已生效|全部通过|已清零|修好了|搞定了)/;

const want = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const files = findSessions(ROOT);
const found = [];

for (const f of files) {
  let evs;
  try { evs = loadEvents(f); } catch { continue; }
  const turns = new Set(evs.map((e) => e && e.data && e.data.turn).filter((t) => typeof t === "number"));
  for (const t of turns) {
    if (want.length && !want.includes(t)) continue;
    const slice = evs.filter((e) => e && e.data && e.data.turn === t);
    // 只要这轮有声明词
    let claimText = "";
    for (const e of slice) {
      if (e.type !== "assistant/message") continue;
      const d = e.data.message || e.data;
      if (!Array.isArray(d.content)) continue;
      for (const c of d.content) {
        if (c && c.type === "text" && typeof c.text === "string" && CLAIM.test(c.text)) claimText += c.text;
      }
    }
    if (!claimText) continue;
    const toolCalls = slice.filter((e) => e.type === "tool/call").map((e) => e.data.name);
    found.push({
      file: f.split("\\").pop(),
      session: f.split("\\").slice(-2)[0].slice(0, 28),
      turn: t,
      tools: toolCalls,
      toolCount: toolCalls.length,
      claimSnippet: claimText.replace(/\s+/g, " ").slice(0, 400),
    });
  }
}

found.sort((a, b) => a.turn - b.turn);
console.log("找到 " + found.length + " 个含声明词的目标轮次\n");
for (const r of found) {
  console.log("=== turn " + r.turn + "  [" + r.session + "]");
  console.log("  工具(" + r.toolCount + "): " + (r.tools.join(", ") || "【本轮零工具调用】"));
  console.log("  声明原文: " + r.claimSnippet);
  console.log("");
}
