#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


PRESETS = {
    "jianlai-wensheng": [
        {
            "id": "character:文圣",
            "name": "文圣",
            "aliases": ["文圣", "老秀才"],
            "group": "文圣一脉",
            "notes": "文圣/老秀才称谓需要后续人工或 LLM 确认是否同一实体。",
        },
        {
            "id": "character:陈平安",
            "name": "陈平安",
            "aliases": ["陈平安", "小师叔", "泥瓶巷少年"],
            "group": "文圣一脉",
        },
        {
            "id": "character:齐静春",
            "name": "齐静春",
            "aliases": ["齐静春", "齐先生"],
            "group": "文圣一脉",
        },
        {
            "id": "character:崔瀺",
            "name": "崔瀺",
            "aliases": ["崔瀺", "国师", "大骊国师"],
            "group": "文圣一脉",
        },
        {
            "id": "character:左右",
            "name": "左右",
            "aliases": ["左右"],
            "group": "文圣一脉",
        },
        {
            "id": "character:君倩",
            "name": "君倩",
            "aliases": ["君倩"],
            "group": "文圣一脉",
        },
        {
            "id": "character:茅小冬",
            "name": "茅小冬",
            "aliases": ["茅小冬"],
            "group": "文圣一脉",
        },
    ]
}


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


def read_lines(path: Path):
    return path.read_text(encoding="utf-8").splitlines()


def load_targets(args):
    targets = []
    if args.preset:
        if args.preset not in PRESETS:
            raise SystemExit(f"Unknown preset: {args.preset}")
        targets.extend(PRESETS[args.preset])
    if args.target:
        for value in args.target:
            parts = [part.strip() for part in value.split("|") if part.strip()]
            if not parts:
                continue
            name = parts[0]
            targets.append(
                {
                    "id": f"character:{name}",
                    "name": name,
                    "aliases": parts,
                    "group": "custom",
                }
            )
    if args.targets_file:
        path = Path(args.targets_file).resolve()
        payload = json.loads(path.read_text(encoding="utf-8"))
        targets.extend(payload.get("targets", payload if isinstance(payload, list) else []))
    if not targets:
        raise SystemExit("No targets provided. Use --preset, --target, or --targets-file.")
    return targets


def chapter_text(lines: list[str], chapter: dict):
    start = int(chapter["lineStart"]) - 1
    end = int(chapter["lineEnd"])
    return "\n".join(lines[start:end])


def snippet_for(text: str, alias: str, max_len: int = 90):
    index = text.find(alias)
    if index < 0:
        return ""
    start = max(0, index - 28)
    end = min(len(text), index + len(alias) + 58)
    snippet = text[start:end].replace("\n", " ")
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet += "..."
    return snippet[:max_len]


def scan_mentions(book_dir: Path, targets: list[dict]):
    chapters = read_jsonl(book_dir / "chapters.jsonl")
    lines = read_lines(book_dir / "corpus" / "book.txt")
    by_target = {target["id"]: [] for target in targets}
    for chapter in chapters:
        text = chapter_text(lines, chapter)
        for target in targets:
            alias_hits = []
            for alias in target.get("aliases", []):
                count = text.count(alias)
                if count:
                    alias_hits.append(
                        {
                            "alias": alias,
                            "count": count,
                            "snippet": snippet_for(text, alias),
                        }
                    )
            if alias_hits:
                by_target[target["id"]].append(
                    {
                        "chapterId": chapter["id"],
                        "ordinal": chapter.get("ordinal"),
                        "heading": chapter.get("heading"),
                        "volume": chapter.get("volume"),
                        "lineStart": chapter.get("lineStart"),
                        "lineEnd": chapter.get("lineEnd"),
                        "aliasHits": alias_hits,
                    }
                )
    return by_target


def graph_coverage(book_dir: Path):
    graph_dir = book_dir / "graph"
    entities = read_jsonl(graph_dir / "entities.jsonl")
    characters = read_jsonl(book_dir / "characters.jsonl")
    relations = read_jsonl(graph_dir / "relations.jsonl")
    entity_chapters = {}
    for entity in entities:
        entity_chapters.setdefault(entity.get("id"), set())
        for evidence in entity.get("evidence", []):
            if evidence.get("chapterId"):
                entity_chapters[entity.get("id")].add(evidence["chapterId"])
    character_chapters = {}
    character_relations = {}
    for character in characters:
        character_id = character.get("characterId")
        chapters = character_chapters.setdefault(character_id, set())
        first_seen = character.get("firstSeen") or {}
        if first_seen.get("chapterId"):
            chapters.add(first_seen["chapterId"])
        for key in ("appearances", "strongRelations", "reviewCandidates", "relationships"):
            for item in character.get(key, []):
                if item.get("chapterId"):
                    chapters.add(item["chapterId"])
        character_relations[character_id] = {
            "strongRelations": len(character.get("strongRelations", [])),
            "reviewCandidates": len(character.get("reviewCandidates", [])),
            "appearances": len(character.get("appearances", [])),
        }
    accepted_relation_counts = {}
    for relation in relations:
        for endpoint in ("sourceId", "targetId"):
            entity_id = relation.get(endpoint)
            accepted_relation_counts[entity_id] = accepted_relation_counts.get(entity_id, 0) + 1
    return entity_chapters, character_chapters, character_relations, accepted_relation_counts


def candidate_entity_ids(target: dict):
    ids = {target["id"]}
    for alias in target.get("aliases", []):
        ids.add(f"character:{alias}")
    return sorted(ids)


def target_report(target: dict, mentions: list[dict], entity_chapters: dict, character_chapters: dict, character_relations: dict, relation_counts: dict):
    mention_chapters = {item["chapterId"] for item in mentions}
    entity_ids = candidate_entity_ids(target)
    graph_chapters = set()
    accepted_relation_count = 0
    card_summary = {}
    matched_graph_entity_ids = []
    for entity_id in entity_ids:
        chapters = set(entity_chapters.get(entity_id, set())) | set(character_chapters.get(entity_id, set()))
        if chapters or relation_counts.get(entity_id):
            matched_graph_entity_ids.append(entity_id)
        graph_chapters |= chapters
        accepted_relation_count += relation_counts.get(entity_id, 0)
        if character_relations.get(entity_id):
            card_summary[entity_id] = character_relations[entity_id]
    missing = sorted(mention_chapters - graph_chapters)
    extra = sorted(graph_chapters - mention_chapters)
    sample_missing = []
    missing_set = set(missing[:10])
    for item in mentions:
        if item["chapterId"] in missing_set:
            sample_missing.append(item)
    return {
        "id": target["id"],
        "name": target["name"],
        "group": target.get("group"),
        "aliases": target.get("aliases", []),
        "notes": target.get("notes"),
        "mentionChapterCount": len(mention_chapters),
        "graphChapterCount": len(graph_chapters),
        "missingChapterCount": len(missing),
        "extraGraphChapterCount": len(extra),
        "acceptedRelationCount": accepted_relation_count,
        "matchedGraphEntityIds": matched_graph_entity_ids,
        "candidateGraphEntityIds": entity_ids,
        "characterCard": card_summary,
        "mentionChapters": [item["chapterId"] for item in mentions],
        "graphChapters": sorted(graph_chapters),
        "missingChapters": missing,
        "extraGraphChapters": extra,
        "sampleMissingChapters": sample_missing,
        "nextQuery": f"{target['name']} {' '.join(target.get('aliases', [])[:3])} 关系 师承 同门",
    }


def write_markdown(path: Path, report: dict):
    lines = [
        "# Entity Coverage Audit",
        "",
        f"- book: `{report['book']}`",
        f"- target count: {report['targetCount']}",
        "",
        "| target | group | mention chapters | graph chapters | missing | accepted relations |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for item in report["targets"]:
        lines.append(
            f"| {item['name']} | {item.get('group') or ''} | {item['mentionChapterCount']} | {item['graphChapterCount']} | {item['missingChapterCount']} | {item['acceptedRelationCount']} |"
        )
    lines.extend(["", "## Missing Chapter Samples", ""])
    for item in report["targets"]:
        lines.append(f"### {item['name']}")
        lines.append("")
        if not item["sampleMissingChapters"]:
            lines.append("- no missing chapter sample")
        for chapter in item["sampleMissingChapters"][:5]:
            alias_text = "; ".join(f"{hit['alias']} x{hit['count']}: {hit['snippet']}" for hit in chapter["aliasHits"][:3])
            lines.append(f"- `{chapter['chapterId']}` {chapter['heading']} ({chapter.get('volume')}) - {alias_text}")
        lines.append("")
        lines.append(f"next query: `{item['nextQuery']}`")
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Audit entity mention coverage against current graph assets.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--preset", choices=sorted(PRESETS.keys()))
    parser.add_argument("--target", action="append", help="Custom target as name|alias1|alias2.")
    parser.add_argument("--targets-file", help="JSON file with target objects.")
    parser.add_argument("--out", help="Defaults to <book>/graph/entity-coverage-audit.json.")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    targets = load_targets(args)
    mentions_by_target = scan_mentions(book_dir, targets)
    entity_chapters, character_chapters, character_relations, relation_counts = graph_coverage(book_dir)
    reports = [
        target_report(
            target,
            mentions_by_target[target["id"]],
            entity_chapters,
            character_chapters,
            character_relations,
            relation_counts,
        )
        for target in targets
    ]
    summary = {
        "book": str(book_dir),
        "targetCount": len(targets),
        "targetsWithMissingChapters": sum(1 for item in reports if item["missingChapterCount"]),
        "totalMentionChapters": sum(item["mentionChapterCount"] for item in reports),
        "totalGraphChapters": sum(item["graphChapterCount"] for item in reports),
        "totalMissingChapters": sum(item["missingChapterCount"] for item in reports),
    }
    payload = {
        **summary,
        "targets": reports,
    }
    out_path = Path(args.out).resolve() if args.out else graph_dir / "entity-coverage-audit.json"
    md_path = out_path.with_suffix(".md")
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(md_path, payload)
    print(f"Targets: {len(targets)}")
    print(f"Targets with missing chapters: {summary['targetsWithMissingChapters']}")
    print(f"Total missing chapters: {summary['totalMissingChapters']}")
    print(f"Wrote {out_path}")
    print(f"Wrote {md_path}")


if __name__ == "__main__":
    main()
