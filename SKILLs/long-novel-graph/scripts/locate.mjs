#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { book: "", limit: 8, query: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--book") args.book = argv[++i] || "";
    else if (token === "--limit") args.limit = Number(argv[++i] || 8);
    else args.query.push(token);
  }
  return args;
}

const stopWords = new Set([
  "一个",
  "一下",
  "哪里",
  "哪章",
  "第几章",
  "发生",
  "出现",
  "时候",
  "什么",
  "怎么",
  "为什么",
  "请问",
  "用户",
  "问题",
  "小说",
  "位置",
]);

function extractTerms(input) {
  const asciiTerms = input.match(/[A-Za-z0-9_]{2,}/g) || [];
  const terms = new Set(asciiTerms);
  const chineseSpans = input.match(/\p{Script=Han}{2,}/gu) || [];

  for (const span of chineseSpans) {
    if (span.length <= 8 && !stopWords.has(span)) terms.add(span);
    for (const size of [6, 5, 4, 3, 2]) {
      for (let i = 0; i + size <= span.length; i += 1) {
        const term = span.slice(i, i + size);
        if (!stopWords.has(term)) terms.add(term);
      }
    }
  }

  return [...terms].filter((term) => term.length >= 2);
}

function findChapterByLine(chapters, lineNo) {
  let low = 0;
  let high = chapters.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const chapter = chapters[middle];
    if (lineNo < chapter.lineStart) high = middle - 1;
    else if (lineNo > chapter.lineEnd) low = middle + 1;
    else return chapter;
  }
  return null;
}

function makeSnippet(line, terms) {
  const normalized = line.trim();
  const firstHit = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstHit === undefined) return normalized.slice(0, 120);
  const start = Math.max(0, firstHit - 45);
  const end = Math.min(normalized.length, firstHit + 85);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
}

const args = parseArgs(process.argv.slice(2));
const query = args.query.join(" ").trim();
if (!args.book || !query) {
  console.error('用法：node locate.mjs --book "/path/to/book-output" "关键词或问题"');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(args.book, "manifest.json"), "utf8"));
const chapters = readFileSync(join(args.book, "chapters.jsonl"), "utf8")
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const lines = readFileSync(manifest.sourcePath, "utf8").split(/\n/);
const terms = extractTerms(query);
const grouped = new Map();

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  let score = 0;
  const matched = [];
  for (const term of terms) {
    if (line.includes(term)) {
      score += term.length >= 4 ? 3 : 1;
      matched.push(term);
    }
  }
  if (!score) continue;

  const chapter = findChapterByLine(chapters, i + 1);
  if (!chapter) continue;

  const hit = {
    score,
    line: i + 1,
    chapterId: chapter.id,
    chapter: chapter.heading,
    volume: chapter.volume,
    matched: [...new Set(matched)].slice(0, 8),
    snippet: makeSnippet(line, terms),
  };
  const previous = grouped.get(chapter.id);
  if (!previous) {
    grouped.set(chapter.id, {
      chapterId: chapter.id,
      chapter: chapter.heading,
      volume: chapter.volume,
      score,
      hits: [hit],
    });
  } else {
    previous.score += score;
    if (previous.hits.length < 3) previous.hits.push(hit);
  }
}

const top = [...grouped.values()].sort((a, b) => b.score - a.score).slice(0, args.limit);
console.log(`查询：${query}`);
console.log(`关键词：${terms.slice(0, 24).join(" / ") || "无"}`);
console.log(`命中章节：${top.length}`);

for (const item of top) {
  console.log("");
  console.log(`- ${item.chapter} (${item.volume || "无卷名"}) score=${item.score}`);
  for (const hit of item.hits) {
    console.log(`  L${hit.line} [${hit.matched.join(", ")}] ${hit.snippet}`);
  }
}
