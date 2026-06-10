#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const HAN_NUM = "一二三四五六七八九十百千万零〇两";

function parseArgs(argv) {
  const args = { source: "", out: "", title: "", slug: "" };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--source") args.source = argv[++i] || "";
    else if (token === "--out") args.out = argv[++i] || "";
    else if (token === "--title") args.title = argv[++i] || "";
    else if (token === "--slug") args.slug = argv[++i] || "";
    else rest.push(token);
  }
  if (!args.source && rest[0]) args.source = rest[0];
  if (!args.out && rest[1]) args.out = rest[1];
  return args;
}

function usage() {
  console.error('用法：node build_index.mjs --source "/path/book.txt" --out "/path/output" --title "书名"');
}

function buildLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "book";
}

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.out) {
  usage();
  process.exit(1);
}

const sourcePath = args.source;
const outputDir = args.out;
const text = readFileSync(sourcePath, "utf8");
const lines = text.split(/\n/);
const lineStarts = buildLineStarts(text);
const sourceHash = createHash("sha256").update(text).digest("hex");
const title = args.title || basename(sourcePath).replace(/\.[^.]+$/, "");
const slug = args.slug || safeSlug(title);

const volumePattern = new RegExp(`^第[${HAN_NUM}0-9]+卷\\s+(.+)$`);
const chapterPattern = new RegExp(`^第([${HAN_NUM}]+|\\d+)章\\s*(.+)$`);

let currentVolume = null;
const chapters = [];

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i].replace(/\r$/, "").trim();
  const volumeMatch = line.match(volumePattern);
  if (volumeMatch) {
    currentVolume = { title: line, name: volumeMatch[1].trim(), line: i + 1 };
    continue;
  }

  const chapterMatch = line.match(chapterPattern);
  if (!chapterMatch) continue;

  chapters.push({
    id: `${slug}-chapter-${String(chapters.length + 1).padStart(4, "0")}`,
    ordinal: chapters.length + 1,
    heading: line,
    chapterNoRaw: chapterMatch[1],
    title: chapterMatch[2].trim(),
    volume: currentVolume?.title || null,
    volumeLine: currentVolume?.line || null,
    lineStart: i + 1,
    charStart: lineStarts[i],
  });
}

for (let i = 0; i < chapters.length; i += 1) {
  const current = chapters[i];
  const next = chapters[i + 1];
  current.lineEnd = next ? next.lineStart - 1 : lines.length;
  current.charEnd = next ? next.charStart - 1 : text.length;
  current.charLength = current.charEnd - current.charStart + 1;
  current.byteStart = byteLength(text.slice(0, current.charStart));
  current.byteEnd = byteLength(text.slice(0, current.charEnd + 1)) - 1;
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(join(outputDir, "corpus"), { recursive: true });

try {
  symlinkSync(sourcePath, join(outputDir, "corpus", "book.txt"));
} catch {
  // 软链接已存在或当前文件系统不允许创建时，不影响索引产物。
}

const manifest = {
  title,
  slug,
  sourcePath,
  sourceSha256: sourceHash,
  generatedAt: new Date().toISOString(),
  encoding: "utf8",
  lineCount: lines.length,
  charCount: text.length,
  byteCount: byteLength(text),
  chapterCount: chapters.length,
  outputFiles: {
    chaptersJsonl: "chapters.jsonl",
    chaptersMarkdown: "chapters.md",
    locateTool: "locate.mjs",
  },
};

const chaptersMarkdown = [
  `# 《${title}》章回索引`,
  "",
  `源文件：\`${sourcePath}\``,
  `章节数：${chapters.length}`,
  `总行数：${lines.length}`,
  "",
  "| 序号 | 卷 | 章节 | 行号范围 | 字符偏移 |",
  "| --- | --- | --- | --- | --- |",
  ...chapters.map((chapter) => {
    const volume = chapter.volume ? chapter.volume.replace(/\|/g, "\\|") : "";
    const heading = chapter.heading.replace(/\|/g, "\\|");
    return `| ${chapter.ordinal} | ${volume} | ${heading} | ${chapter.lineStart}-${chapter.lineEnd} | ${chapter.charStart}-${chapter.charEnd} |`;
  }),
  "",
].join("\n");

writeJson(join(outputDir, "manifest.json"), manifest);
writeFileSync(join(outputDir, "chapters.jsonl"), `${chapters.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf8");
writeFileSync(join(outputDir, "chapters.md"), chaptersMarkdown, "utf8");

console.log(`Indexed ${chapters.length} chapters from ${lines.length} lines.`);
console.log(`Output: ${outputDir}`);
