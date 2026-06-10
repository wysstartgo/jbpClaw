#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path


def read_jsonl(path: Path):
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def stable_id(*parts: str):
    return hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()[:16]


def chapter_ranges(book_dir: Path):
    return {
        item["id"]: {
            "lineStart": int(item["lineStart"]),
            "lineEnd": int(item["lineEnd"]),
        }
        for item in read_jsonl(book_dir / "chapters.jsonl")
    }


def require_anchor(item: dict, chapters: dict):
    chapter_id = item.get("chapterId")
    line_start = int(item.get("lineStart", 0))
    line_end = int(item.get("lineEnd", 0))
    if chapter_id not in chapters:
        raise SystemExit(f"Unknown chapterId: {chapter_id}")
    allowed = chapters[chapter_id]
    if not (allowed["lineStart"] <= line_start <= line_end <= allowed["lineEnd"]):
        raise SystemExit(f"Alias evidence is outside chapter range: {chapter_id} L{line_start}-{line_end}")
    if not str(item.get("evidenceText", "")).strip():
        raise SystemExit("Alias promotion requires evidenceText.")


def main():
    parser = argparse.ArgumentParser(description="Promote a reviewed alias candidate into graph/aliases.jsonl.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--alias-id", required=True, help="Alias candidate id from graph/alias-candidates.jsonl.")
    parser.add_argument("--rationale", required=True, help="Review rationale for confirming this alias.")
    parser.add_argument("--evidence-chapter-id", help="Optional stronger evidence chapterId.")
    parser.add_argument("--evidence-line-start", type=int, help="Optional stronger evidence lineStart.")
    parser.add_argument("--evidence-line-end", type=int, help="Optional stronger evidence lineEnd.")
    parser.add_argument("--evidence-text", help="Optional stronger evidence text.")
    parser.add_argument("--confidence", type=float, default=0.9)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not (0 <= args.confidence <= 1):
        raise SystemExit("--confidence must be between 0 and 1.")

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    chapters = chapter_ranges(book_dir)
    candidates_path = graph_dir / "alias-candidates.jsonl"
    aliases_path = graph_dir / "aliases.jsonl"
    candidates = read_jsonl(candidates_path)
    candidate = next((item for item in candidates if item.get("id") == args.alias_id), None)
    if not candidate:
        raise SystemExit(f"Alias candidate not found: {args.alias_id}")

    promoted = {
        "id": "alias-confirmed:" + stable_id(
            candidate["canonicalEntityId"],
            candidate["candidateEntityId"],
            args.evidence_chapter_id or candidate["chapterId"],
            str(args.evidence_line_start or candidate["lineStart"]),
            args.evidence_text or candidate["evidenceText"],
        ),
        "canonicalEntityId": candidate["canonicalEntityId"],
        "aliasEntityId": candidate["candidateEntityId"],
        "aliasName": candidate["candidateName"],
        "entityType": candidate["entityType"],
        "bookSlug": candidate["bookSlug"],
        "chapterId": args.evidence_chapter_id or candidate["chapterId"],
        "lineStart": args.evidence_line_start or candidate["lineStart"],
        "lineEnd": args.evidence_line_end or candidate["lineEnd"],
        "source": "extracted",
        "confidence": args.confidence,
        "evidenceText": args.evidence_text or candidate["evidenceText"],
        "rationale": args.rationale,
        "promotedFrom": candidate["id"],
    }
    require_anchor(promoted, chapters)

    existing = read_jsonl(aliases_path)
    by_id = {item["id"]: item for item in existing}
    by_id[promoted["id"]] = promoted
    merged = sorted(by_id.values(), key=lambda item: item["id"])

    summary = {
        "dryRun": args.dry_run,
        "aliasId": promoted["id"],
        "canonicalEntityId": promoted["canonicalEntityId"],
        "aliasEntityId": promoted["aliasEntityId"],
        "aliasName": promoted["aliasName"],
        "aliasesTotal": len(merged),
        "output": str(aliases_path),
    }
    summary_path = graph_dir / "alias-promotion-summary.json"
    if not args.dry_run:
        write_jsonl(aliases_path, merged)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
