// 定性 turn 97：唯一未定案的边缘案例。
// 为什么要看全文而不是摘要：判它是真阳性还是误报，取决于"那 8 次工具调用里
// 有没有一次能区分成功与失败"，以及"全部通过"这句声明指向的是哪件事。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".dsh", "sessions");
function find(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) find(p, out); else if (e.name.endsWith(".jsonl.zstd")) out.push(p);
  }
  return out;
}
function load(file) {
  const buf = readFileSync(file);
  const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const s = []; let i = 0;
  while (i < buf.length) { const at = buf.indexOf(M, i); if (at < 0) break; s.push(at); i = at + 4; }
  const parts = [];
  for (let k = 0; k < s.length; k++) {
    try { parts.push(zstdDecompressSync(buf.subarray(s[k], k + 1 < s.length ? s[k + 1] : buf.length))); } catch {}
  }
  const evs = [];
  for (const l of Buffer.concat(parts).toString("utf8").split("\n")) { if (l.trim()) { try { evs.push(JSON.parse(l)); } catch {} } }
  return evs;
}

const target = find(ROOT).find((f) => f.includes("5f092f3f"));
if (!target) { console.log("未找到该会话"); process.exit(0); }
const evs = load(target);
const slice = evs.filter((e) => e && e.data && e.data.turn === 97);

console.log("=== turn 97 完整事件序列 ===\n");
for (const e of slice) {
  if (e.type === "tool/call") {
    let a = ""; try { a = JSON.stringify(JSON.parse(e.data.arguments)).slice(0, 160); } catch { a = String(e.data.arguments).slice(0, 160); }
    console.log("[调用] " + e.data.name + "  args=" + a);
  } else if (e.type === "tool/result") {
    const t = typeof e.data.result === "string" ? e.data.result : JSON.stringify(e.data.result || "");
    console.log("[结果] " + t.replace(/\s+/g, " ").slice(0, 200));
  } else if (e.type === "assistant/message") {
    const d = e.data.message || e.data;
    if (Array.isArray(d.content)) for (const c of d.content) {
      if (c && c.type === "text" && typeof c.text === "string") console.log("[说] " + c.text.replace(/\s+/g, " ").slice(0, 700));
    }
  }
}
