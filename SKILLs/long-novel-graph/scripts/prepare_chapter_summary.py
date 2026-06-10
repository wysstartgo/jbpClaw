#!/usr/bin/env python3
import argparse
import importlib.util
import json
from pathlib import Path


def read_jsonl(path: Path):
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_query_module():
    script_dir = Path(__file__).resolve().parent
    module_path = script_dir / "query_retrieval.py"
    spec = importlib.util.spec_from_file_location("query_retrieval", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def chapter_text(source_lines: list[str], chapter: dict, max_chars: int):
    selected = source_lines[chapter["lineStart"] - 1 : chapter["lineEnd"]]
    text = "\n".join(selected).strip()
    truncated = len(text) > max_chars
    return text[:max_chars], truncated


def read_id_list(path: Path):
    ids = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            value = line.strip()
            if value and not value.startswith("#"):
                ids.append(value)
    return ids


def read_search_file(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("results", payload if isinstance(payload, list) else [])
    ids = []
    for item in rows:
        chapter_id = item.get("chapterId")
        if chapter_id and chapter_id not in ids:
            ids.append(chapter_id)
    return ids


def output_schema():
    return {
        "summaries": [
            {
                "chapterId": "jianlai-chapter-0403",
                "chapter": "第四百零二章 在书院",
                "volume": "第六卷 小夫子",
                "lineStart": 51910,
                "lineEnd": 51947,
                "summary": "本章内容摘要。",
                "keyEvents": ["事件一"],
                "characters": ["人物"],
                "locations": ["地点"],
                "artifacts": ["物品"],
                "concepts": ["概念"],
                "source": "extracted",
                "confidence": 0.85,
                "evidenceText": "摘要对应的关键原文短句"
            }
        ]
    }


def main():
    parser = argparse.ArgumentParser(description="Prepare chapter summary task JSON from retrieved chapters.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--query", help="Question used to retrieve candidate chapters.")
    parser.add_argument("--chapter-id", action="append", default=[], help="Explicit chapter id. Can be repeated.")
    parser.add_argument("--chapter-list", help="Text file with one chapter id per line.")
    parser.add_argument("--from-search-file", help="JSON file with retrieval results containing chapterId fields.")
    parser.add_argument("--overwrite", action="store_true", help="Include chapters even if already summarized.")
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--max-chars", type=int, default=12000)
    parser.add_argument("--out", help="Defaults to <book>/graph/chapter-summary-task.json.")
    args = parser.parse_args()

    if not args.query and not args.chapter_id and not args.chapter_list and not args.from_search_file:
        raise SystemExit("Provide --query, --chapter-id, --chapter-list, or --from-search-file.")

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((book_dir / "manifest.json").read_text(encoding="utf-8"))
    chapters = {chapter["id"]: chapter for chapter in read_jsonl(book_dir / "chapters.jsonl")}
    existing_summary_ids = {
        item["chapterId"]
        for item in read_jsonl(book_dir / "chapter-summaries.jsonl")
        if item.get("chapterId")
    }
    source_lines = Path(manifest["sourcePath"]).read_text(encoding="utf-8").split("\n")

    selected_ids = []
    if args.query:
        query_module = load_query_module()
        _terms, results = query_module.search(book_dir, args.query, args.limit)
        for item in results:
            if item["chapterId"] not in selected_ids:
                selected_ids.append(item["chapterId"])

    for chapter_id in args.chapter_id:
        if chapter_id not in selected_ids:
            selected_ids.append(chapter_id)

    if args.chapter_list:
        for chapter_id in read_id_list(Path(args.chapter_list).resolve()):
            if chapter_id not in selected_ids:
                selected_ids.append(chapter_id)

    if args.from_search_file:
        for chapter_id in read_search_file(Path(args.from_search_file).resolve()):
            if chapter_id not in selected_ids:
                selected_ids.append(chapter_id)

    candidates = []
    skipped_existing = []
    missing_ids = []
    for chapter_id in selected_ids[: args.limit]:
        chapter = chapters.get(chapter_id)
        if not chapter:
            missing_ids.append(chapter_id)
            continue
        if not args.overwrite and chapter_id in existing_summary_ids:
            skipped_existing.append(chapter_id)
            continue
        text, truncated = chapter_text(source_lines, chapter, args.max_chars)
        candidates.append(
            {
                "chapterId": chapter["id"],
                "chapter": chapter["heading"],
                "volume": chapter.get("volume"),
                "lineStart": chapter["lineStart"],
                "lineEnd": chapter["lineEnd"],
                "truncated": truncated,
                "text": text,
            }
        )

    task = {
        "task": "Summarize candidate chapters and extract content assets. Use only the provided chapter text.",
        "rules": [
            "Do not use outside knowledge.",
            "Every summary must include chapterId, lineStart, lineEnd, source, confidence, and evidenceText.",
            "Keep summary concise and factual.",
            "Prefer fewer high-quality keyEvents over noisy lists.",
            "Do not quote long copyrighted passages; evidenceText should be a short anchor.",
        ],
        "book": {
            "title": manifest.get("title"),
            "slug": manifest.get("slug"),
            "sourceSha256": manifest.get("sourceSha256"),
        },
        "query": args.query,
        "selectedChapterIds": selected_ids,
        "skippedExistingChapterIds": skipped_existing,
        "missingChapterIds": missing_ids,
        "outputSchema": output_schema(),
        "candidateChapters": candidates,
    }

    out_path = Path(args.out).resolve() if args.out else graph_dir / "chapter-summary-task.json"
    out_path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(candidates)} candidate chapters.")
    print(f"Skipped existing summaries: {len(skipped_existing)}")
    print(f"Missing chapter ids: {len(missing_ids)}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
