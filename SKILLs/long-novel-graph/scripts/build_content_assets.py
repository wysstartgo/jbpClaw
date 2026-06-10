#!/usr/bin/env python3
import argparse
import json
from collections import defaultdict
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


def entity_map(entities: list[dict]):
    return {item["id"]: item for item in entities}


def first_evidence(entity: dict):
    evidence = entity.get("evidence") or []
    if not evidence:
        return None
    return sorted(evidence, key=lambda item: (item.get("lineStart", 10**12), item.get("lineEnd", 10**12)))[0]


def build_events(entities: list[dict], relations: list[dict], summaries: list[dict]):
    entities_by_id = entity_map(entities)
    events_by_id = {}

    for entity in entities:
        if entity.get("type") != "Event":
            continue
        evidence = first_evidence(entity) or {}
        events_by_id[entity["id"]] = {
            "eventId": entity["id"],
            "name": entity.get("name"),
            "chapterId": evidence.get("chapterId"),
            "lineStart": evidence.get("lineStart"),
            "lineEnd": evidence.get("lineEnd"),
            "participants": [],
            "locations": [],
            "artifacts": [],
            "eventType": "unknown",
            "evidenceText": evidence.get("evidenceText", ""),
            "source": evidence.get("source", "extracted"),
            "confidence": evidence.get("confidence", 0.7),
        }

    for relation in relations:
        source = entities_by_id.get(relation.get("sourceId"))
        target = entities_by_id.get(relation.get("targetId"))
        if not source or not target:
            continue
        rel_type = relation.get("type")
        if rel_type == "PARTICIPATES_IN" and target.get("type") == "Event":
            event = events_by_id.setdefault(
                target["id"],
                {
                    "eventId": target["id"],
                    "name": target.get("name"),
                    "chapterId": relation.get("chapterId"),
                    "lineStart": relation.get("lineStart"),
                    "lineEnd": relation.get("lineEnd"),
                    "participants": [],
                    "locations": [],
                    "artifacts": [],
                    "eventType": "unknown",
                    "evidenceText": relation.get("evidenceText", ""),
                    "source": relation.get("source", "extracted"),
                    "confidence": relation.get("confidence", 0.7),
                },
            )
            if source.get("type") == "Character" and source.get("name") not in event["participants"]:
                event["participants"].append(source.get("name"))
        elif rel_type == "OCCURS_IN" and source and source.get("type") == "Event":
            event = events_by_id.get(source["id"])
            if event and target.get("name") not in event["locations"]:
                event["locations"].append(target.get("name"))
        elif rel_type == "OWNS_OR_USES" and source and target and source.get("type") == "Event":
            event = events_by_id.get(source["id"])
            if event and target.get("name") not in event["artifacts"]:
                event["artifacts"].append(target.get("name"))

    for summary in summaries:
        for key_event in summary.get("keyEvents", []):
            event_id = f"event:{key_event}"
            events_by_id.setdefault(
                event_id,
                {
                    "eventId": event_id,
                    "name": key_event,
                    "chapterId": summary.get("chapterId"),
                    "lineStart": summary.get("lineStart"),
                    "lineEnd": summary.get("lineEnd"),
                    "participants": summary.get("characters", []),
                    "locations": summary.get("locations", []),
                    "artifacts": summary.get("artifacts", []),
                    "eventType": "summary",
                    "evidenceText": summary.get("evidenceText", ""),
                    "source": summary.get("source", "extracted"),
                    "confidence": summary.get("confidence", 0.75),
                },
            )

    return sorted(events_by_id.values(), key=lambda item: (item.get("lineStart") or 10**12, item["eventId"]))


def relation_card(relation: dict, target: dict):
    return {
        "targetId": target["id"],
        "targetName": target.get("name"),
        "targetType": target.get("type"),
        "type": relation.get("type"),
        "chapterId": relation.get("chapterId"),
        "lineStart": relation.get("lineStart"),
        "lineEnd": relation.get("lineEnd"),
        "confidence": relation.get("confidence"),
        "source": relation.get("source"),
        "evidenceText": relation.get("evidenceText", ""),
        "temporalQualifier": relation.get("temporalQualifier"),
        "status": relation.get("status"),
        "statusNote": relation.get("statusNote"),
        "validFromChapterId": relation.get("validFromChapterId"),
        "validToChapterId": relation.get("validToChapterId"),
        "reviewReasons": relation.get("reviewReasons", []),
    }


def build_characters(entities: list[dict], relations: list[dict], review_relations: list[dict], summaries: list[dict], aliases: list[dict]):
    entities_by_id = entity_map(entities)
    strong_relations = defaultdict(list)
    appearances = defaultdict(list)
    review_candidates = defaultdict(list)
    aliases_by_character = defaultdict(list)
    confirmed_alias_entity_ids = set()

    for alias in aliases:
        confirmed_alias_entity_ids.add(alias.get("aliasEntityId"))
        aliases_by_character[alias.get("canonicalEntityId")].append(
            {
                "aliasName": alias.get("aliasName"),
                "aliasEntityId": alias.get("aliasEntityId"),
                "chapterId": alias.get("chapterId"),
                "lineStart": alias.get("lineStart"),
                "lineEnd": alias.get("lineEnd"),
                "confidence": alias.get("confidence"),
                "evidenceText": alias.get("evidenceText", ""),
                "rationale": alias.get("rationale", ""),
            }
        )

    for relation in relations:
        if relation.get("type") == "CO_OCCURS_WITH" or relation.get("source") == "ambiguous":
            continue
        source = entities_by_id.get(relation.get("sourceId"))
        target = entities_by_id.get(relation.get("targetId"))
        if not source or not target:
            continue
        if source.get("type") == "Character":
            card = relation_card(relation, target)
            if relation.get("type") == "APPEARS_IN":
                appearances[source["id"]].append(card)
            else:
                strong_relations[source["id"]].append(card)

    for relation in review_relations:
        source = entities_by_id.get(relation.get("sourceId"))
        target = entities_by_id.get(relation.get("targetId"))
        if not source or not target:
            continue
        if source.get("type") == "Character":
            review_candidates[source["id"]].append(relation_card(relation, target))

    summary_by_character = defaultdict(list)
    for summary in summaries:
        for name in summary.get("characters", []):
            summary_by_character[name].append(
                {
                    "chapterId": summary.get("chapterId"),
                    "lineStart": summary.get("lineStart"),
                    "lineEnd": summary.get("lineEnd"),
                    "summary": summary.get("summary"),
                }
            )

    characters = []
    for entity in entities:
        if entity.get("type") != "Character":
            continue
        if entity.get("id") in confirmed_alias_entity_ids:
            continue
        evidence = first_evidence(entity) or {}
        description_bits = [item["summary"] for item in summary_by_character.get(entity.get("name"), [])[:2] if item.get("summary")]
        character_strong = strong_relations.get(entity["id"], [])
        character_appearances = appearances.get(entity["id"], [])
        character_review = review_candidates.get(entity["id"], [])
        characters.append(
            {
                "characterId": entity["id"],
                "name": entity.get("name"),
                "aliases": aliases_by_character.get(entity["id"], []),
                "firstSeen": {
                    "chapterId": evidence.get("chapterId"),
                    "lineStart": evidence.get("lineStart"),
                    "lineEnd": evidence.get("lineEnd"),
                },
                "description": "；".join(description_bits),
                "traits": [],
                "strongRelations": character_strong,
                "appearances": character_appearances,
                "reviewCandidates": character_review,
                "relationships": character_strong + character_appearances,
                "evidence": entity.get("evidence", []),
            }
        )
    return sorted(characters, key=lambda item: (item["firstSeen"].get("lineStart") or 10**12, item["name"] or ""))


def main():
    parser = argparse.ArgumentParser(description="Build events.jsonl and characters.jsonl from graph and chapter summaries.")
    parser.add_argument("--book", required=True)
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    entities = read_jsonl(graph_dir / "entities.jsonl")
    relations = read_jsonl(graph_dir / "relations.jsonl")
    review_relations = read_jsonl(graph_dir / "review-relations.jsonl")
    aliases = read_jsonl(graph_dir / "aliases.jsonl")
    summaries = read_jsonl(book_dir / "chapter-summaries.jsonl")

    events = build_events(entities, relations, summaries)
    characters = build_characters(entities, relations, review_relations, summaries, aliases)
    events_path = book_dir / "events.jsonl"
    characters_path = book_dir / "characters.jsonl"
    write_jsonl(events_path, events)
    write_jsonl(characters_path, characters)

    summary_path = graph_dir / "content-assets-summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "events": len(events),
                "characters": len(characters),
                "reviewRelations": len(review_relations),
                "aliases": len(aliases),
                "outputs": {
                    "events": str(events_path),
                    "characters": str(characters_path),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Events: {len(events)}")
    print(f"Characters: {len(characters)}")
    print(f"Wrote {events_path}")
    print(f"Wrote {characters_path}")


if __name__ == "__main__":
    main()
