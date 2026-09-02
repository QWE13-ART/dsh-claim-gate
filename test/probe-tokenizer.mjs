// 定位「英文 query 返回空」的真因。不猜 —— 两个候选：
//   ① 分词器吃掉了英文    ② poolDocs 拼的 text 里不含技能名
// 直接调真实 tokenize（经 buildIndex 间接）+ 读 poolDocs 的真实产物。
import { pathToFileURL } from "node:url";
const SS = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/skill-search.js").href);
const BM = await import(pathToFileURL("E:/DSH-Data/dsh-skill-folder/lib/bm25.js").href);
console.log("skill-search.js 导出 = " + Object.keys(SS).join(", "));
console.log("bm25.js 导出 = " + Object.keys(BM).join(", "));

// 候选① 分词器是否吃英文：用 bm25 直接建一个含英文的小索引
const docs = [
  { id: "autotelic-evolution", text: "autotelic-evolution 自主学习进化引擎 self evolution learning" },
  { id: "other", text: "无关技能 完全不同的内容" },
];
const idx = BM.buildIndex(docs);
for (const q of ["autotelic", "self evolution learning", "evolution", "进化"]) {
  const hits = BM.search(idx, q, 3);
  console.log("  BM25 直测 \"" + q + "\" → " + (hits.length ? hits.map((i)=>docs[i].id).join(",") : "（空）"));
}

// 候选② poolDocs 拼的 text 到底含什么 —— 读源码那几行
import { readFileSync } from "node:fs";
const src = readFileSync("E:/DSH-Data/dsh-skill-folder/lib/skill-search.js", "utf8");
const m = src.match(/function poolDocs[\s\S]{0,600}?\n}/);
console.log("\n=== poolDocs 真实实现 ===");
console.log(m ? m[0] : "未找到 poolDocs");
