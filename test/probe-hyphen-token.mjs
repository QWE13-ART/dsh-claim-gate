// 假设：分词正则 [a-z0-9][a-z0-9_+-]{1,} 把 "autotelic-evolution" 切成单个整 token，
// 所以查 "autotelic" 永不匹配（term 不相等）。
// 这是能推翻自己的实验：直接看 tokenize 的真实输出。
import { pathToFileURL } from "node:url";
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);

console.log("=== tokenize 真实输出（假设的直接检验）===");
for (const s of ["autotelic-evolution", "dsh-self-evolution", "self evolution learning", "autotelic"]) {
  console.log("  \"" + s + "\"  →  [" + BM.tokenize(s).join(" | ") + "]");
}

// 若假设成立：'autotelic-evolution' 是 1 个 token，不含 'autotelic'
const toks = BM.tokenize("autotelic-evolution");
console.log("\n  假设成立 = " + (toks.length === 1 && toks[0] === "autotelic-evolution" && !toks.includes("autotelic")));

// 影响面：119 技能里有多少个名字含连字符？这些名字的「词根」全都搜不到
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const SK = join(homedir(), ".dsh", "skills");
const names = readdirSync(SK, { withFileTypes: true }).filter((d) => d.isDirectory()
  && existsSync(join(SK, d.name, "SKILL.md"))).map((d) => d.name);
const hyphen = names.filter((n) => n.includes("-"));
console.log("\n=== 影响面 ===");
console.log("  matched/total = " + hyphen.length + "/" + names.length + "  (名字含连字符的技能)");
console.log("  未匹配样本（名字无连字符、不受影响的，前 5 条）：");
names.filter((n) => !n.includes("-")).slice(0, 5).forEach((n) => console.log("    - " + n));

// 逐个验：用「名字的第一段」当 query，能不能搜到自己？
const pool = names.map((n) => ({ id: n, text: n }));   // 只用名字，隔离 description 干扰
const idx = BM.buildIndex(pool);
let ok = 0; const fail = [];
for (const n of hyphen) {
  const head = n.split("-")[0];
  const hits = BM.search(idx, head, 5).map((i) => pool[i].id);
  if (hits.includes(n)) ok++; else fail.push(n + "  (查 \"" + head + "\")");
}
console.log("\n=== 用名字首段搜自己 ===");
console.log("  matched/total = " + ok + "/" + hyphen.length);
console.log("  未匹配样本（前 6 条）：");
fail.slice(0, 6).forEach((f) => console.log("    - " + f));
