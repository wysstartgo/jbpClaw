#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


SYMMETRIC_RELATION_TYPES = {"FELLOW_DISCIPLE_OF", "FRIEND_OF", "RELATED_TO"}
DIRECTION_LABELS = {
    "outgoing": "向外关系",
    "incoming": "指向该实体",
    "symmetric-display": "对称展示",
}


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def entity_name(entity_id: str) -> str:
    if ":" not in entity_id:
        return entity_id
    return entity_id.split(":", 1)[1]


def load_alias_index(book_dir: Path) -> tuple[dict[str, set[str]], dict[str, str]]:
    aliases = read_jsonl(book_dir / "graph" / "aliases.jsonl")
    groups: dict[str, set[str]] = {}
    alias_to_canonical: dict[str, str] = {}
    for alias in aliases:
        canonical_id = alias.get("canonicalEntityId")
        if not canonical_id:
            continue
        group = groups.setdefault(canonical_id, {canonical_id})
        alias_entity_id = alias.get("aliasEntityId")
        alias_name = str(alias.get("aliasName", "")).strip()
        if alias_entity_id:
            group.add(alias_entity_id)
            alias_to_canonical[alias_entity_id] = canonical_id
            alias_to_canonical[entity_name(alias_entity_id)] = canonical_id
        if alias_name:
            alias_to_canonical[alias_name] = canonical_id
        alias_to_canonical[canonical_id] = canonical_id
        alias_to_canonical[entity_name(canonical_id)] = canonical_id
    return groups, alias_to_canonical


def load_entity_names(book_dir: Path) -> dict[str, str]:
    names = {}
    for entity in read_jsonl(book_dir / "graph" / "entities.jsonl"):
        entity_id = entity.get("id")
        if entity_id:
            names[entity_id] = entity.get("name") or entity_name(entity_id)
    return names


def resolve_entity_group(book_dir: Path, name: str) -> dict:
    groups, alias_to_canonical = load_alias_index(book_dir)
    entity_names = load_entity_names(book_dir)
    direct_id = name if ":" in name else None
    canonical_id = alias_to_canonical.get(name) or (alias_to_canonical.get(direct_id) if direct_id else None)

    if not canonical_id:
        for entity_id, entity_display_name in entity_names.items():
            if name == entity_display_name or name == entity_name(entity_id) or name == entity_id:
                canonical_id = alias_to_canonical.get(entity_id, entity_id)
                break

    if not canonical_id:
        candidate_id = f"character:{name}"
        if candidate_id in entity_names:
            canonical_id = alias_to_canonical.get(candidate_id, candidate_id)

    if not canonical_id:
        return {"input": name, "found": False, "entityIds": [], "names": []}

    entity_ids = set(groups.get(canonical_id, {canonical_id}))
    entity_ids.add(canonical_id)
    names = sorted({entity_names.get(entity_id, entity_name(entity_id)) for entity_id in entity_ids})
    return {
        "input": name,
        "found": True,
        "canonicalEntityId": canonical_id,
        "entityIds": sorted(entity_ids),
        "names": names,
    }


def relation_matches_group(relation: dict, entity_ids: set[str], include_reverse: bool) -> list[dict]:
    matches = []
    source_id = relation.get("sourceId")
    target_id = relation.get("targetId")
    if source_id in entity_ids:
        matches.append({"direction": "outgoing", "relation": relation, "reverseDisplay": False})
    if target_id in entity_ids:
        if include_reverse and source_id not in entity_ids and relation.get("type") in SYMMETRIC_RELATION_TYPES:
            matches.append({"direction": "symmetric-display", "relation": relation, "reverseDisplay": True})
        else:
            matches.append({"direction": "incoming", "relation": relation, "reverseDisplay": False})
    return matches


def query_graph(book_dir: Path, name: str, include_review: bool = False, include_reverse: bool = True, relation_type: str | None = None):
    group = resolve_entity_group(book_dir, name)
    if not group["found"]:
        return {"entity": group, "relations": [], "reviewRelations": []}

    entity_ids = set(group["entityIds"])
    entity_names = load_entity_names(book_dir)
    relations = read_jsonl(book_dir / "graph" / "relations.jsonl")
    review_relations = read_jsonl(book_dir / "graph" / "review-relations.jsonl") if include_review else []

    def normalize_match(match: dict, review: bool = False):
        relation = match["relation"]
        source_id = relation.get("sourceId")
        target_id = relation.get("targetId")
        display_source_id = target_id if match.get("reverseDisplay") else source_id
        display_target_id = source_id if match.get("reverseDisplay") else target_id
        return {
            "direction": match["direction"],
            "reverseDisplay": match.get("reverseDisplay", False),
            "review": review,
            "id": relation.get("id"),
            "sourceId": source_id,
            "sourceName": entity_names.get(source_id, entity_name(source_id or "")),
            "type": relation.get("type"),
            "targetId": target_id,
            "targetName": entity_names.get(target_id, entity_name(target_id or "")),
            "displaySourceId": display_source_id,
            "displaySourceName": entity_names.get(display_source_id, entity_name(display_source_id or "")),
            "displayTargetId": display_target_id,
            "displayTargetName": entity_names.get(display_target_id, entity_name(display_target_id or "")),
            "chapterId": relation.get("chapterId"),
            "lineStart": relation.get("lineStart"),
            "lineEnd": relation.get("lineEnd"),
            "confidence": relation.get("confidence"),
            "source": relation.get("source"),
            "evidenceText": relation.get("evidenceText"),
            "rationale": relation.get("rationale"),
            "reviewReasons": relation.get("reviewReasons", []),
            "temporalQualifier": relation.get("temporalQualifier"),
            "status": relation.get("status"),
            "statusNote": relation.get("statusNote"),
            "validFromChapterId": relation.get("validFromChapterId"),
            "validToChapterId": relation.get("validToChapterId"),
        }

    accepted_matches = []
    for relation in relations:
        if relation_type and relation.get("type") != relation_type:
            continue
        for match in relation_matches_group(relation, entity_ids, include_reverse):
            accepted_matches.append(normalize_match(match))

    review_matches = []
    for relation in review_relations:
        if relation_type and relation.get("type") != relation_type:
            continue
        for match in relation_matches_group(relation, entity_ids, include_reverse):
            review_matches.append(normalize_match(match, review=True))

    accepted_matches.sort(key=lambda item: (item["chapterId"] or "", item["lineStart"] or 0, item["type"] or ""))
    review_matches.sort(key=lambda item: (item["chapterId"] or "", item["lineStart"] or 0, item["type"] or ""))
    return {"entity": group, "relations": accepted_matches, "reviewRelations": review_matches}


def relation_status(item: dict) -> str:
    parts = [value for value in (item.get("temporalQualifier"), item.get("status")) if value]
    return " / ".join(parts)


def relation_anchor(item: dict) -> str:
    return f"{item.get('chapterId') or '-'} L{item.get('lineStart') or '-'}-{item.get('lineEnd') or '-'}"


def markdown_relation_item(item: dict, index: int, review: bool = False) -> list[str]:
    label = DIRECTION_LABELS.get(item.get("direction"), item.get("direction") or "-")
    review_mark = "（待审）" if review else ""
    lines = [
        f"{index}. {item['displaySourceName']} --{item.get('type') or '-'}--> {item['displayTargetName']} {review_mark}".rstrip(),
        f"   - 方向：{label}",
        f"   - 证据位置：`{relation_anchor(item)}`",
        f"   - 置信度：`{item.get('confidence') if item.get('confidence') is not None else '-'}`",
    ]
    status = relation_status(item)
    if status:
        lines.append(f"   - 状态：`{status}`")
    if item.get("statusNote"):
        lines.append(f"   - 状态说明：{item['statusNote']}")
    if review:
        reasons = ", ".join(item.get("reviewReasons") or []) or "-"
        lines.append(f"   - 待审原因：`{reasons}`")
    if item.get("rationale"):
        lines.append(f"   - 依据说明：{item['rationale']}")
    if item.get("evidenceText"):
        lines.append(f"   - 原文证据：{item['evidenceText']}")
    return lines


def print_markdown(payload: dict):
    entity = payload["entity"]
    if not entity["found"]:
        print(f"**图谱查询结果**\n\n未找到实体或 confirmed alias：`{entity['input']}`")
        return

    print("**图谱查询结果**")
    print("")
    print(f"- 查询：`{entity['input']}`")
    print(f"- 归一实体：`{entity['canonicalEntityId']}`")
    print(f"- 同组名称：{' / '.join(entity['names'])}")
    print(f"- 实体 ID：`{' / '.join(entity['entityIds'])}`")
    print(f"- Accepted 关系数：`{len(payload['relations'])}`")
    if payload["reviewRelations"]:
        print(f"- Review 关系数：`{len(payload['reviewRelations'])}`")

    print("")
    print("**已接受关系**")
    print("")
    if not payload["relations"]:
        print("暂无已接受关系。")
    else:
        for index, item in enumerate(payload["relations"], start=1):
            print("\n".join(markdown_relation_item(item, index)))
            print("")

    if payload["reviewRelations"]:
        print("**待审关系**")
        print("")
        print("以下关系尚未进入 accepted graph，只能作为审阅线索。")
        print("")
        for index, item in enumerate(payload["reviewRelations"], start=1):
            print("\n".join(markdown_relation_item(item, index, review=True)))
            print("")


def print_human(payload: dict):
    entity = payload["entity"]
    if not entity["found"]:
        print(f"未找到实体或 confirmed alias：{entity['input']}")
        return

    print(f"查询实体：{entity['input']}")
    print(f"归一实体：{entity['canonicalEntityId']}")
    print(f"同组名称：{' / '.join(entity['names'])}")
    print(f"实体 ID：{' / '.join(entity['entityIds'])}")
    print(f"accepted 关系：{len(payload['relations'])}")
    for item in payload["relations"]:
        print("")
        print(
            f"- [{item['direction']}] {item['displaySourceName']} --{item['type']}--> {item['displayTargetName']} "
            f"({item['chapterId']} L{item['lineStart']}-{item['lineEnd']}, confidence={item['confidence']})"
        )
        if item.get("temporalQualifier") or item.get("status"):
            status_parts = [value for value in (item.get("temporalQualifier"), item.get("status")) if value]
            print(f"  状态：{' / '.join(status_parts)}")
            if item.get("statusNote"):
                print(f"  状态说明：{item['statusNote']}")
        if item.get("evidenceText"):
            print(f"  证据：{item['evidenceText']}")

    if payload["reviewRelations"]:
        print("")
        print(f"review 关系：{len(payload['reviewRelations'])}")
        for item in payload["reviewRelations"]:
            print("")
            print(
                f"- [{item['direction']}] {item['displaySourceName']} --{item['type']}--> {item['displayTargetName']} "
                f"({item['chapterId']} L{item['lineStart']}-{item['lineEnd']})"
            )
            if item.get("temporalQualifier") or item.get("status"):
                status_parts = [value for value in (item.get("temporalQualifier"), item.get("status")) if value]
                print(f"  状态：{' / '.join(status_parts)}")
            print(f"  reviewReasons：{', '.join(item.get('reviewReasons') or [])}")


def main():
    parser = argparse.ArgumentParser(description="Query accepted graph relations by entity name or confirmed alias.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--name", required=True, help="Entity name, entity id, or confirmed alias.")
    parser.add_argument("--relation-type", help="Optional relation type filter.")
    parser.add_argument("--include-review", action="store_true", help="Also show review-relations.jsonl matches.")
    parser.add_argument("--no-reverse", action="store_true", help="Disable symmetric display for near-symmetric relation types.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--markdown", action="store_true", help="Print a Chinese Markdown report with evidence anchors.")
    args = parser.parse_args()

    payload = query_graph(
        Path(args.book).resolve(),
        args.name,
        include_review=args.include_review,
        include_reverse=not args.no_reverse,
        relation_type=args.relation_type,
    )
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    if args.markdown:
        print_markdown(payload)
        return
    print_human(payload)


if __name__ == "__main__":
    main()
