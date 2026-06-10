#!/usr/bin/env python3
import argparse
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


def write_jsonl(path: Path, rows: list[dict]):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def strip_review_fields(relation: dict, rationale: str | None):
    clean = {key: value for key, value in relation.items() if key != "reviewReasons"}
    if rationale:
        clean["rationale"] = rationale
    return clean


def main():
    parser = argparse.ArgumentParser(description="Promote one reviewed relation into graph/relations.jsonl.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--relation-id", required=True)
    parser.add_argument("--rationale", help="Optional reviewed rationale to attach before promotion.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    relations_path = graph_dir / "relations.jsonl"
    review_path = graph_dir / "review-relations.jsonl"
    summary_path = graph_dir / "review-promotion-summary.json"

    relations = read_jsonl(relations_path)
    review_relations = read_jsonl(review_path)
    target = next((item for item in review_relations if item.get("id") == args.relation_id), None)
    if not target:
        raise SystemExit(f"Review relation not found: {args.relation_id}")

    promoted = strip_review_fields(target, args.rationale)
    existing_ids = {item.get("id") for item in relations}
    if promoted["id"] in existing_ids:
        raise SystemExit(f"Relation already exists in main relations: {promoted['id']}")

    remaining_review = [item for item in review_relations if item.get("id") != args.relation_id]
    result = {
        "dryRun": args.dry_run,
        "promotedRelationId": promoted["id"],
        "fromReviewCount": len(review_relations),
        "toReviewCount": len(remaining_review),
        "fromRelationCount": len(relations),
        "toRelationCount": len(relations) + 1,
        "relation": promoted,
    }

    if not args.dry_run:
        write_jsonl(relations_path, sorted(relations + [promoted], key=lambda item: item["id"]))
        write_jsonl(review_path, sorted(remaining_review, key=lambda item: item["id"]))
        summary_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Dry run: {args.dry_run}")
    print(f"Promote: {promoted['id']}")
    print(f"Relations: {len(relations)} -> {len(relations) + 1}")
    print(f"Review relations: {len(review_relations)} -> {len(remaining_review)}")
    if not args.dry_run:
        print(f"Wrote {summary_path}")


if __name__ == "__main__":
    main()
