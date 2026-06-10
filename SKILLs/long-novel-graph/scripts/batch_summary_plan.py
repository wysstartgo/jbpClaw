#!/usr/bin/env python3
import argparse
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


def write_lines(path: Path, values: list[str]):
    path.write_text("\n".join(values) + ("\n" if values else ""), encoding="utf-8")


def in_range(chapter: dict, start: str | None, end: str | None):
    chapter_id = chapter["id"]
    if start and chapter_id < start:
        return False
    if end and chapter_id > end:
        return False
    return True


def chunked(values: list[dict], size: int):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def main():
    parser = argparse.ArgumentParser(description="Create batched chapter summary plans.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--volume", help="Only include chapters whose volume exactly matches this value.")
    parser.add_argument("--start-chapter-id", help="Inclusive chapter id lower bound.")
    parser.add_argument("--end-chapter-id", help="Inclusive chapter id upper bound.")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--limit", type=int, help="Maximum chapters to include after filtering.")
    parser.add_argument("--include-existing", action="store_true", help="Include chapters already present in chapter-summaries.jsonl.")
    parser.add_argument("--out", help="Defaults to <book>/graph/chapter-summary-batches.json.")
    args = parser.parse_args()

    if args.batch_size < 1:
        raise SystemExit("--batch-size must be >= 1")

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    chapters = read_jsonl(book_dir / "chapters.jsonl")
    existing_summary_ids = {
        item["chapterId"]
        for item in read_jsonl(book_dir / "chapter-summaries.jsonl")
        if item.get("chapterId")
    }

    selected = []
    skipped_existing = []
    for chapter in chapters:
        if args.volume and chapter.get("volume") != args.volume:
            continue
        if not in_range(chapter, args.start_chapter_id, args.end_chapter_id):
            continue
        if not args.include_existing and chapter["id"] in existing_summary_ids:
            skipped_existing.append(chapter["id"])
            continue
        selected.append(chapter)
        if args.limit and len(selected) >= args.limit:
            break

    batch_dir = graph_dir / "chapter-summary-batches"
    batch_dir.mkdir(parents=True, exist_ok=True)
    batches = []
    for batch_index, batch in enumerate(chunked(selected, args.batch_size), start=1):
        chapter_ids = [chapter["id"] for chapter in batch]
        list_path = batch_dir / f"batch-{batch_index:04d}.txt"
        write_lines(list_path, chapter_ids)
        batches.append(
            {
                "batchId": f"batch-{batch_index:04d}",
                "chapterList": str(list_path),
                "chapterCount": len(chapter_ids),
                "chapterIds": chapter_ids,
                "lineStart": batch[0]["lineStart"],
                "lineEnd": batch[-1]["lineEnd"],
            }
        )

    plan = {
        "book": str(book_dir),
        "filters": {
            "volume": args.volume,
            "startChapterId": args.start_chapter_id,
            "endChapterId": args.end_chapter_id,
            "batchSize": args.batch_size,
            "limit": args.limit,
            "includeExisting": args.include_existing,
        },
        "selectedChapters": len(selected),
        "skippedExisting": len(skipped_existing),
        "skippedExistingChapterIds": skipped_existing,
        "batches": batches,
        "nextCommandTemplate": "python3 scripts/prepare_chapter_summary.py --book <book> --chapter-list <chapterList> --out <task.json>",
    }
    out_path = Path(args.out).resolve() if args.out else graph_dir / "chapter-summary-batches.json"
    out_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Selected chapters: {len(selected)}")
    print(f"Skipped existing: {len(skipped_existing)}")
    print(f"Batches: {len(batches)}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
