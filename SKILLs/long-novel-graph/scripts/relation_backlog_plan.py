#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


DEFAULT_CUES = [
    "文圣一脉",
    "文脉",
    "师兄",
    "师弟",
    "师妹",
    "先生",
    "学生",
    "弟子",
    "记名弟子",
    "首徒",
    "同门",
    "师承",
    "国师",
    "大骊国师",
    "老秀才",
    "齐先生",
]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path):
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def read_lines(path: Path):
    return path.read_text(encoding="utf-8").splitlines()


def write_lines(path: Path, values: list[str]):
    path.write_text("\n".join(values) + ("\n" if values else ""), encoding="utf-8")


def chapter_text(lines: list[str], chapter: dict):
    return "\n".join(lines[int(chapter["lineStart"]) - 1 : int(chapter["lineEnd"])])


def snippet_for(text: str, term: str, max_len: int = 100):
    index = text.find(term)
    if index < 0:
        return ""
    start = max(0, index - 32)
    end = min(len(text), index + len(term) + 64)
    snippet = text[start:end].replace("\n", " ")
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet += "..."
    return snippet[:max_len]


def chunked(values: list[dict], size: int):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def load_chapters(book_dir: Path):
    chapters = read_jsonl(book_dir / "chapters.jsonl")
    return {item["id"]: item for item in chapters}


def chapter_cues(text: str, cues: list[str]):
    hits = []
    for cue in cues:
        count = text.count(cue)
        if count:
            hits.append({"cue": cue, "count": count, "snippet": snippet_for(text, cue)})
    return hits


def score_chapter(target: dict, chapter: dict, text: str, cues: list[str]):
    cue_hits = chapter_cues(text, cues)
    alias_hits = []
    for alias in target.get("aliases", []):
        count = text.count(alias)
        if count:
            alias_hits.append({"alias": alias, "count": count, "snippet": snippet_for(text, alias)})
    return {
        "chapterId": chapter["id"],
        "ordinal": chapter.get("ordinal"),
        "heading": chapter.get("heading"),
        "volume": chapter.get("volume"),
        "lineStart": chapter.get("lineStart"),
        "lineEnd": chapter.get("lineEnd"),
        "score": sum(hit["count"] for hit in cue_hits) * 5 + sum(hit["count"] for hit in alias_hits),
        "cueHits": cue_hits,
        "aliasHits": alias_hits,
    }


def select_targets(audit: dict, target_names: set[str] | None, groups: set[str] | None):
    targets = []
    for target in audit.get("targets", []):
        if target_names and target.get("name") not in target_names and target.get("id") not in target_names:
            continue
        if groups and target.get("group") not in groups:
            continue
        targets.append(target)
    return targets


def build_batches(book_dir: Path, audit: dict, targets: list[dict], batch_size: int, limit_per_target: int | None, cues: list[str], out_dir: Path):
    chapters_by_id = load_chapters(book_dir)
    lines = read_lines(book_dir / "corpus" / "book.txt")
    batch_dir = out_dir / "relation-backlog-batches"
    batch_dir.mkdir(parents=True, exist_ok=True)
    batches = []
    for target in targets:
        candidates = []
        for chapter_id in target.get("missingChapters", []):
            chapter = chapters_by_id.get(chapter_id)
            if not chapter:
                continue
            text = chapter_text(lines, chapter)
            item = score_chapter(target, chapter, text, cues)
            candidates.append(item)
        candidates.sort(key=lambda item: (-item["score"], item.get("ordinal") or 0))
        if limit_per_target:
            candidates = candidates[:limit_per_target]
        for batch_index, batch in enumerate(chunked(candidates, batch_size), start=1):
            batch_id = f"{target['name']}-batch-{batch_index:04d}"
            safe_batch_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in batch_id)
            list_path = batch_dir / f"{safe_batch_id}.txt"
            write_lines(list_path, [item["chapterId"] for item in batch])
            batches.append(
                {
                    "batchId": safe_batch_id,
                    "targetId": target.get("id"),
                    "targetName": target.get("name"),
                    "group": target.get("group"),
                    "chapterList": str(list_path),
                    "chapterCount": len(batch),
                    "score": sum(item["score"] for item in batch),
                    "chapterIds": [item["chapterId"] for item in batch],
                    "chapters": batch,
                    "nextRelationQuery": target.get("nextQuery") or f"{target.get('name')} 关系 师承 同门",
                    "recommendedCommand": f"python3 scripts/prepare_chapter_summary.py --book <book> --chapter-list {list_path}",
                }
            )
    batches.sort(key=lambda item: (-item["score"], item["targetName"], item["batchId"]))
    return batches


def write_markdown(path: Path, plan: dict):
    lines = [
        "# Relation Backlog Plan",
        "",
        f"- book: `{plan['book']}`",
        f"- batch count: {len(plan['batches'])}",
        f"- batch size: {plan['filters']['batchSize']}",
        "",
        "| batch | target | chapters | score | chapter list |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for batch in plan["batches"][:80]:
        lines.append(
            f"| {batch['batchId']} | {batch['targetName']} | {batch['chapterCount']} | {batch['score']} | `{batch['chapterList']}` |"
        )
    lines.extend(["", "## Top Batch Details", ""])
    for batch in plan["batches"][:12]:
        lines.append(f"### {batch['batchId']}")
        lines.append("")
        lines.append(f"- target: {batch['targetName']}")
        lines.append(f"- next query: `{batch['nextRelationQuery']}`")
        for chapter in batch["chapters"][:5]:
            cue_text = "; ".join(f"{hit['cue']} x{hit['count']}: {hit['snippet']}" for hit in chapter["cueHits"][:3])
            alias_text = "; ".join(f"{hit['alias']} x{hit['count']}" for hit in chapter["aliasHits"][:3])
            lines.append(f"- `{chapter['chapterId']}` {chapter['heading']} score={chapter['score']} aliases=[{alias_text}] cues=[{cue_text}]")
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Create relation extraction backlog batches from entity coverage audit.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--audit", help="Defaults to <book>/graph/entity-coverage-audit.json.")
    parser.add_argument("--target", action="append", help="Target name or id to include.")
    parser.add_argument("--group", action="append", help="Target group to include.")
    parser.add_argument("--cue", action="append", help="Extra relation cue. Defaults include lineage and teacher/student terms.")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--limit-per-target", type=int)
    parser.add_argument("--out", help="Defaults to <book>/graph/relation-backlog-plan.json.")
    args = parser.parse_args()

    if args.batch_size < 1:
        raise SystemExit("--batch-size must be >= 1")
    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    audit_path = Path(args.audit).resolve() if args.audit else graph_dir / "entity-coverage-audit.json"
    out_path = Path(args.out).resolve() if args.out else graph_dir / "relation-backlog-plan.json"
    audit = read_json(audit_path)
    target_names = set(args.target) if args.target else None
    groups = set(args.group) if args.group else None
    targets = select_targets(audit, target_names, groups)
    cues = DEFAULT_CUES + (args.cue or [])
    batches = build_batches(book_dir, audit, targets, args.batch_size, args.limit_per_target, cues, out_path.parent)
    plan = {
        "book": str(book_dir),
        "audit": str(audit_path),
        "filters": {
            "targets": sorted(target_names) if target_names else None,
            "groups": sorted(groups) if groups else None,
            "batchSize": args.batch_size,
            "limitPerTarget": args.limit_per_target,
            "cues": cues,
        },
        "targetCount": len(targets),
        "batchCount": len(batches),
        "batches": batches,
    }
    out_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(out_path.with_suffix(".md"), plan)
    print(f"Targets: {len(targets)}")
    print(f"Batches: {len(batches)}")
    print(f"Wrote {out_path}")
    print(f"Wrote {out_path.with_suffix('.md')}")


if __name__ == "__main__":
    main()
