// 核验：decide() 对候选轮次的真实判定（不是我记忆里的判定）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";
import { decide } from "file:///E:/DSH-Data/dsh-claim-gate/lib/index.js";

const ROOT = join(homedir(), ".dsh", "sessions");
function findSessions(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findSessions(p, out); else if (e.name.endsWith(".jsonl.zstd")) out.push(p);
  }
  return out;
}
function loadEvents(file) {
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = []; let i = 0;
  while (i < buf.length) { const at = buf.indexOf(MAGIC, i); if (at < 0) break; starts.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], end))); } catch {}
  }
  const evs = [];
  for (const l of Buffer.concat(parts).toString("utf8").split("\n")) { if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} } }
  return evs;
}

// 全库找出所有真正判 unverified 的轮次 —— 这些才是候选真阳性
const hits = [];
for (const f of findSessions(ROOT)) {
  let evs; try { evs = loadEvents(f); } catch { continue; }
  const turns = [...new Set(evs.map((e) => e && e.data && e.data.turn).filter((t) => typeof t === "number"))];
  for (const t of turns) {
    const r = decide(evs, t);
    if (r.verdict !== "unverified") continue;
    const slice = evs.filter((e) => e && e.data && e.data.turn === t);
    const tools = slice.filter((e) => e.type === "tool/call").map((e) => e.data.name);
    let text = "";
    for (const e of slice) {
      if (e.type !== "assistant/message") continue;
      const d = e.data.message || e.data;
      if (!Array.isArray(d.content)) continue;
      for (const c of d.content) if (c && c.type === "text" && typeof c.text === "string") text += c.text;
    }
    hits.push({
      session: f.split("\\").slice(-2)[0],
      turn: t, claim: r.claim, reason: r.reason || "-",
      toolCount: tools.length, tools: tools.slice(0, 6),
      text: text.replace(/\s+/g, " ").slice(0, 300),
    });
  }
}

console.log("=== decide() 真实判 unverified 的全部轮次：" + hits.length + " 个 ===\n");
for (const h of hits) {
  console.log("turn " + h.turn + "  claim=「" + h.claim + "」  reason=" + h.reason + "  工具数=" + h.toolCount);
  console.log("  session: " + h.session);
  if (h.toolCount) console.log("  工具: " + h.tools.join(", "));
  console.log("  原文: " + h.text);
  console.log("");
}
