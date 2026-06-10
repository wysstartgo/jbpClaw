#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { source: "", out: "", title: "", slug: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--source") args.source = argv[++i] || "";
    else if (token === "--out") args.out = argv[++i] || "";
    else if (token === "--title") args.title = argv[++i] || "";
    else if (token === "--slug") args.slug = argv[++i] || "";
  }
  return args;
}

function safeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "book";
}

const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  console.error('用法：node init_book.mjs --source "/path/book.txt" [--out "/path/output"] [--title "书名"]');
  process.exit(1);
}

const title = args.title || basename(args.source).replace(/\.[^.]+$/, "");
const slug = args.slug || safeSlug(title);
const out = args.out ? resolve(args.out) : resolve("data", "novel-index", slug);

mkdirSync(out, { recursive: true });

const buildArgs = [
  join(SCRIPT_DIR, "build_index.mjs"),
  "--source",
  args.source,
  "--out",
  out,
  "--title",
  title,
  "--slug",
  slug,
];

const result = spawnSync(process.execPath, buildArgs, { stdio: "inherit" });
process.exit(result.status ?? 1);
