#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


SOURCES = {"extracted", "inferred", "ambiguous"}
MIN_EVIDENCE_CHARS = 6
LOW_CONFIDENCE = 0.65


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


def task_ranges(task: dict):
    return {
        item["chapterId"]: {
            "chapter": item["chapter"],
            "volume": item.get("volume"),
            "lineStart": int(item["lineStart"]),
            "lineEnd": int(item["lineEnd"]),
        }
        for item in task.get("candidateChapters", [])
    }


def normalize_summary(raw: dict, ranges: dict):
    chapter_id = raw.get("chapterId")
    if chapter_id not in ranges:
        raise ValueError(f"Summary chapterId was not in task candidates: {chapter_id}")
    allowed = ranges[chapter_id]
    line_start = int(raw.get("lineStart", allowed["lineStart"]))
    line_end = int(raw.get("lineEnd", allowed["lineEnd"]))
    if not (allowed["lineStart"] <= line_start <= line_end <= allowed["lineEnd"]):
        raise ValueError(f"Summary line range outside chapter candidate: {raw}")

    source = raw.get("source", "extracted")
    confidence = float(raw.get("confidence", 0))
    summary = str(raw.get("summary", "")).strip()
    evidence_text = str(raw.get("evidenceText", "")).strip()
    if source not in SOURCES:
        raise ValueError(f"Invalid source: {raw}")
    if not (0 <= confidence <= 1):
        raise ValueError(f"Invalid confidence: {raw}")
    if not summary:
        raise ValueError(f"Missing summary: {raw}")
    if not evidence_text:
        raise ValueError(f"Missing evidenceText: {raw}")

    def list_of_strings(key):
        value = raw.get(key, [])
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    return {
        "chapterId": chapter_id,
        "chapter": raw.get("chapter") or allowed["chapter"],
        "volume": raw.get("volume", allowed.get("volume")),
        "lineStart": line_start,
        "lineEnd": line_end,
        "summary": summary,
        "keyEvents": list_of_strings("keyEvents"),
        "characters": list_of_strings("characters"),
        "locations": list_of_strings("locations"),
        "artifacts": list_of_strings("artifacts"),
        "concepts": list_of_strings("concepts"),
        "source": source,
        "confidence": confidence,
        "evidenceText": evidence_text,
    }


def quality_report(incoming: list[dict], existing: dict, merged: list[dict]):
    duplicate_chapter_ids = sorted([item["chapterId"] for item in incoming if item["chapterId"] in existing])
    low_confidence = [
        {
            "chapterId": item["chapterId"],
            "confidence": item["confidence"],
        }
        for item in incoming
        if item["confidence"] < LOW_CONFIDENCE
    ]
    short_evidence = [
        {
            "chapterId": item["chapterId"],
            "evidenceText": item["evidenceText"],
        }
        for item in incoming
        if len(item["evidenceText"]) < MIN_EVIDENCE_CHARS
    ]
    sparse_assets = []
    for item in incoming:
        empty_keys = [
            key
            for key in ("keyEvents", "characters", "locations", "artifacts", "concepts")
            if not item.get(key)
        ]
        if empty_keys:
            sparse_assets.append({"chapterId": item["chapterId"], "emptyFields": empty_keys})

    return {
        "incomingSummaries": len(incoming),
        "duplicateChapterIds": duplicate_chapter_ids,
        "lowConfidence": low_confidence,
        "shortEvidence": short_evidence,
        "sparseAssets": sparse_assets,
        "totalSummariesAfterMerge": len(merged),
        "thresholds": {
            "lowConfidence": LOW_CONFIDENCE,
            "minEvidenceChars": MIN_EVIDENCE_CHARS,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Validate and merge chapter summaries.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--task", help="Defaults to <book>/graph/chapter-summary-task.json.")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    task_path = Path(args.task).resolve() if args.task else graph_dir / "chapter-summary-task.json"
    input_path = Path(args.input).resolve()
    task = json.loads(task_path.read_text(encoding="utf-8"))
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    ranges = task_ranges(task)

    incoming = [normalize_summary(item, ranges) for item in payload.get("summaries", [])]
    output_path = book_dir / "chapter-summaries.jsonl"
    existing = {item["chapterId"]: item for item in read_jsonl(output_path)}
    existing_before = dict(existing)
    for item in incoming:
        existing[item["chapterId"]] = item
    merged = sorted(existing.values(), key=lambda item: item["lineStart"])
    write_jsonl(output_path, merged)
    report = quality_report(incoming, existing_before, merged)

    summary_path = graph_dir / "chapter-summary-merge-summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "input": str(input_path),
                "task": str(task_path),
                "mergedSummaries": len(incoming),
                "totalSummaries": len(merged),
                "qualityReport": str(graph_dir / "chapter-summary-quality-report.json"),
                "output": str(output_path),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    quality_path = graph_dir / "chapter-summary-quality-report.json"
    quality_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Merged summaries: {len(incoming)}")
    print(f"Total summaries: {len(merged)}")
    print(f"Quality report: {quality_path}")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
