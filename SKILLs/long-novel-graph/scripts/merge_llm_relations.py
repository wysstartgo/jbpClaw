#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path


ENTITY_TYPES = {"Character", "Location", "Faction", "Artifact", "Event", "Concept", "Chapter"}
RELATION_TYPES = {
    "PARTICIPATES_IN",
    "OCCURS_IN",
    "OWNS_OR_USES",
    "BELONGS_TO",
    "MENTORS",
    "DISCIPLE_OF",
    "FELLOW_DISCIPLE_OF",
    "LINEAGE_OF",
    "FRIEND_OF",
    "OPPOSES",
    "RELATED_TO",
}
SOURCES = {"extracted", "inferred", "ambiguous"}
REVIEW_CONFIDENCE = 0.65
TEMPORAL_QUALIFIERS = {"current", "former", "later", "transition", "historical", "ambiguous"}


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


def stable_id(*parts: str) -> str:
    return hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()[:16]


def evidence_ranges(task: dict):
    ranges = []
    for chunk in task.get("candidateChunks", []):
        ranges.append(
            {
                "chunkId": chunk["chunkId"],
                "bookSlug": chunk["bookSlug"],
                "chapterId": chunk["chapterId"],
                "lineStart": int(chunk["lineStart"]),
                "lineEnd": int(chunk["lineEnd"]),
            }
        )
    return ranges


def find_range(ranges: list[dict], chapter_id: str, line_start: int, line_end: int):
    for item in ranges:
        if item["chapterId"] != chapter_id:
            continue
        if item["lineStart"] <= line_start <= line_end <= item["lineEnd"]:
            return item
    return None


def normalize_entity(raw: dict, ranges: list[dict]):
    entity_type = raw.get("type")
    name = str(raw.get("name", "")).strip()
    chapter_id = raw.get("chapterId")
    line_start = int(raw.get("lineStart", 0))
    line_end = int(raw.get("lineEnd", 0))
    source = raw.get("source", "extracted")
    confidence = float(raw.get("confidence", 0))
    evidence_text = str(raw.get("evidenceText", "")).strip()

    if entity_type not in ENTITY_TYPES or not name:
        raise ValueError(f"Invalid entity: {raw}")
    matched = find_range(ranges, chapter_id, line_start, line_end)
    if not matched:
        raise ValueError(f"Entity evidence is outside candidate chunks: {raw}")
    if source not in SOURCES:
        raise ValueError(f"Invalid entity source: {raw}")
    if not (0 <= confidence <= 1):
        raise ValueError(f"Invalid entity confidence: {raw}")
    if not evidence_text:
        raise ValueError(f"Missing entity evidenceText: {raw}")

    entity_id = raw.get("id") or f"{entity_type.lower()}:{name}"
    return {
        "id": entity_id,
        "type": entity_type,
        "name": name,
        "evidence": [
            {
                "bookSlug": matched["bookSlug"],
                "chapterId": chapter_id,
                "lineStart": line_start,
                "lineEnd": line_end,
                "source": source,
                "confidence": confidence,
                "evidenceText": evidence_text,
            }
        ],
    }


def normalize_relation(raw: dict, ranges: list[dict]):
    rel_type = raw.get("type")
    source_id = str(raw.get("sourceId", "")).strip()
    target_id = str(raw.get("targetId", "")).strip()
    chapter_id = raw.get("chapterId")
    line_start = int(raw.get("lineStart", 0))
    line_end = int(raw.get("lineEnd", 0))
    source = raw.get("source", "extracted")
    confidence = float(raw.get("confidence", 0))
    evidence_text = str(raw.get("evidenceText", "")).strip()

    if rel_type not in RELATION_TYPES:
        raise ValueError(f"Invalid relation type: {raw}")
    if not source_id or not target_id:
        raise ValueError(f"Missing relation endpoints: {raw}")
    matched = find_range(ranges, chapter_id, line_start, line_end)
    if not matched:
        raise ValueError(f"Relation evidence is outside candidate chunks: {raw}")
    if source not in SOURCES:
        raise ValueError(f"Invalid relation source: {raw}")
    if not (0 <= confidence <= 1):
        raise ValueError(f"Invalid relation confidence: {raw}")
    if not evidence_text:
        raise ValueError(f"Missing relation evidenceText: {raw}")

    rel_id = raw.get("id") or f"rel:{stable_id(source_id, target_id, rel_type, chapter_id, str(line_start), str(line_end), evidence_text)}"
    relation = {
        "id": rel_id,
        "sourceId": source_id,
        "targetId": target_id,
        "type": rel_type,
        "bookSlug": matched["bookSlug"],
        "chapterId": chapter_id,
        "lineStart": line_start,
        "lineEnd": line_end,
        "source": source,
        "confidence": confidence,
        "evidenceText": evidence_text,
        "rationale": raw.get("rationale"),
    }
    temporal_qualifier = raw.get("temporalQualifier")
    if temporal_qualifier is not None:
        if temporal_qualifier not in TEMPORAL_QUALIFIERS:
            raise ValueError(f"Invalid temporalQualifier: {raw}")
        relation["temporalQualifier"] = temporal_qualifier
    for key in ("status", "statusNote", "validFromChapterId", "validToChapterId"):
        value = raw.get(key)
        if value is not None:
            relation[key] = value
    return relation


def normalize_alias_candidate(raw: dict, ranges: list[dict]):
    canonical_id = str(raw.get("canonicalEntityId", "")).strip()
    candidate_id = str(raw.get("candidateEntityId", "")).strip()
    candidate_name = str(raw.get("candidateName", "")).strip()
    entity_type = raw.get("entityType")
    chapter_id = raw.get("chapterId")
    line_start = int(raw.get("lineStart", 0))
    line_end = int(raw.get("lineEnd", 0))
    source = raw.get("source", "extracted")
    confidence = float(raw.get("confidence", 0))
    evidence_text = str(raw.get("evidenceText", "")).strip()
    rationale = str(raw.get("rationale", "")).strip()

    if not canonical_id or not candidate_id or not candidate_name:
        raise ValueError(f"Missing alias candidate fields: {raw}")
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"Invalid alias candidate entity type: {raw}")
    matched = find_range(ranges, chapter_id, line_start, line_end)
    if not matched:
        raise ValueError(f"Alias candidate evidence is outside candidate chunks: {raw}")
    if source not in SOURCES:
        raise ValueError(f"Invalid alias candidate source: {raw}")
    if not (0 <= confidence <= 1):
        raise ValueError(f"Invalid alias candidate confidence: {raw}")
    if not evidence_text:
        raise ValueError(f"Missing alias candidate evidenceText: {raw}")
    if not rationale:
        raise ValueError(f"Missing alias candidate rationale: {raw}")

    alias_id = raw.get("id") or f"alias:{stable_id(canonical_id, candidate_id, chapter_id, str(line_start), evidence_text)}"
    return {
        "id": alias_id,
        "canonicalEntityId": canonical_id,
        "candidateEntityId": candidate_id,
        "candidateName": candidate_name,
        "entityType": entity_type,
        "bookSlug": matched["bookSlug"],
        "chapterId": chapter_id,
        "lineStart": line_start,
        "lineEnd": line_end,
        "source": source,
        "confidence": confidence,
        "evidenceText": evidence_text,
        "rationale": rationale,
    }


def normalize_relation_conflict(raw: dict, ranges: list[dict]):
    relation = normalize_relation(raw.get("relation", {}), ranges)
    conflicts_with = raw.get("conflictsWith") or {}
    conflict_reason = str(raw.get("conflictReason", "")).strip()
    if not conflict_reason:
        raise ValueError(f"Missing conflictReason: {raw}")
    if conflicts_with.get("type") and conflicts_with["type"] not in RELATION_TYPES:
        raise ValueError(f"Invalid conflictsWith relation type: {raw}")
    conflict_id = raw.get("id") or f"conflict:{stable_id(relation['id'], json.dumps(conflicts_with, sort_keys=True, ensure_ascii=False), conflict_reason)}"
    return {
        "id": conflict_id,
        "relation": relation,
        "conflictsWith": conflicts_with,
        "conflictReason": conflict_reason,
    }


def normalize_reverse_suggestion(raw: dict, ranges: list[dict]):
    relation = normalize_relation(raw.get("relation", {}), ranges)
    suggested_reverse_type = raw.get("suggestedReverseType")
    reason = str(raw.get("reason", "")).strip()
    if suggested_reverse_type not in RELATION_TYPES:
        raise ValueError(f"Invalid suggestedReverseType: {raw}")
    if not reason:
        raise ValueError(f"Missing reverse suggestion reason: {raw}")
    suggestion_id = raw.get("id") or f"reverse:{stable_id(relation['id'], suggested_reverse_type, reason)}"
    return {
        "id": suggestion_id,
        "relation": relation,
        "suggestedReverseType": suggested_reverse_type,
        "reason": reason,
    }


def merge_entities(existing: list[dict], incoming: list[dict]):
    by_id = {item["id"]: item for item in existing}
    for entity in incoming:
        current = by_id.get(entity["id"])
        if not current:
            by_id[entity["id"]] = entity
            continue
        current_evidence = current.setdefault("evidence", [])
        seen = {(e.get("chapterId"), e.get("lineStart"), e.get("lineEnd"), e.get("evidenceText")) for e in current_evidence}
        for evidence in entity.get("evidence", []):
            key = (evidence.get("chapterId"), evidence.get("lineStart"), evidence.get("lineEnd"), evidence.get("evidenceText"))
            if key not in seen:
                current_evidence.append(evidence)
    return sorted(by_id.values(), key=lambda item: item["id"])


def merge_relations(existing: list[dict], incoming: list[dict]):
    by_id = {item["id"]: item for item in existing}
    for relation in incoming:
        by_id[relation["id"]] = relation
    return sorted(by_id.values(), key=lambda item: item["id"])


def relation_review_reasons(relation: dict):
    reasons = []
    if relation.get("source") == "ambiguous":
        reasons.append("ambiguous_source")
    if float(relation.get("confidence", 0)) < REVIEW_CONFIDENCE:
        reasons.append("low_confidence")
    if relation.get("type") != "APPEARS_IN" and not relation.get("rationale"):
        reasons.append("missing_rationale")
    return reasons


def split_review_relations(relations: list[dict]):
    accepted = []
    review = []
    for relation in relations:
        reasons = relation_review_reasons(relation)
        if reasons:
            review.append({**relation, "reviewReasons": reasons})
        else:
            accepted.append(relation)
    return accepted, review


def merge_review_relations(existing: list[dict], incoming: list[dict]):
    by_id = {item["id"]: item for item in existing}
    for relation in incoming:
        by_id[relation["id"]] = relation
    return sorted(by_id.values(), key=lambda item: item["id"])


def merge_by_id(existing: list[dict], incoming: list[dict]):
    by_id = {item["id"]: item for item in existing}
    for item in incoming:
        by_id[item["id"]] = item
    return sorted(by_id.values(), key=lambda item: item["id"])


def main():
    parser = argparse.ArgumentParser(description="Validate and merge LLM-extracted strong relations into graph JSONL files.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--input", required=True, help="LLM JSON output path.")
    parser.add_argument("--task", help="Task JSON path. Defaults to <book>/graph/llm-relation-task.json.")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    task_path = Path(args.task).resolve() if args.task else graph_dir / "llm-relation-task.json"
    input_path = Path(args.input).resolve()

    task = json.loads(task_path.read_text(encoding="utf-8"))
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    ranges = evidence_ranges(task)

    incoming_entities = [normalize_entity(item, ranges) for item in payload.get("entities", [])]
    relation_items = payload.get("relations", []) + payload.get("acceptedRelations", [])
    incoming_relations = [normalize_relation(item, ranges) for item in relation_items]
    explicit_review_relations = []
    for item in payload.get("reviewRelations", []):
        relation = normalize_relation(item, ranges)
        reasons = item.get("reviewReasons") or relation_review_reasons(relation) or ["explicit_review"]
        explicit_review_relations.append({**relation, "reviewReasons": reasons})
    alias_candidates = [normalize_alias_candidate(item, ranges) for item in payload.get("aliasCandidates", [])]
    relation_conflicts = [normalize_relation_conflict(item, ranges) for item in payload.get("relationConflicts", [])]
    reverse_suggestions = [normalize_reverse_suggestion(item, ranges) for item in payload.get("reverseRelationSuggestions", [])]
    accepted_relations, review_relations = split_review_relations(incoming_relations)
    review_relations.extend(explicit_review_relations)

    entities_path = graph_dir / "entities.jsonl"
    relations_path = graph_dir / "relations.jsonl"
    review_path = graph_dir / "review-relations.jsonl"
    alias_path = graph_dir / "alias-candidates.jsonl"
    conflict_path = graph_dir / "relation-conflicts.jsonl"
    reverse_path = graph_dir / "reverse-relation-suggestions.jsonl"
    existing_entities = read_jsonl(entities_path)
    existing_relations = read_jsonl(relations_path)
    existing_review_relations = read_jsonl(review_path)
    existing_alias_candidates = read_jsonl(alias_path)
    existing_relation_conflicts = read_jsonl(conflict_path)
    existing_reverse_suggestions = read_jsonl(reverse_path)

    merged_entities = merge_entities(existing_entities, incoming_entities)
    merged_relations = merge_relations(existing_relations, accepted_relations)
    merged_review_relations = merge_review_relations(existing_review_relations, review_relations)
    merged_alias_candidates = merge_by_id(existing_alias_candidates, alias_candidates)
    merged_relation_conflicts = merge_by_id(existing_relation_conflicts, relation_conflicts)
    merged_reverse_suggestions = merge_by_id(existing_reverse_suggestions, reverse_suggestions)
    write_jsonl(entities_path, merged_entities)
    write_jsonl(relations_path, merged_relations)
    write_jsonl(review_path, merged_review_relations)
    write_jsonl(alias_path, merged_alias_candidates)
    write_jsonl(conflict_path, merged_relation_conflicts)
    write_jsonl(reverse_path, merged_reverse_suggestions)

    summary_path = graph_dir / "llm-merge-summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "input": str(input_path),
                "task": str(task_path),
                "mergedEntities": len(incoming_entities),
                "acceptedRelations": len(accepted_relations),
                "reviewRelations": len(review_relations),
                "aliasCandidates": len(alias_candidates),
                "relationConflicts": len(relation_conflicts),
                "reverseRelationSuggestions": len(reverse_suggestions),
                "totalEntities": len(merged_entities),
                "totalRelations": len(merged_relations),
                "totalReviewRelations": len(merged_review_relations),
                "totalAliasCandidates": len(merged_alias_candidates),
                "totalRelationConflicts": len(merged_relation_conflicts),
                "totalReverseRelationSuggestions": len(merged_reverse_suggestions),
                "reviewOutput": str(review_path),
                "aliasOutput": str(alias_path),
                "conflictOutput": str(conflict_path),
                "reverseSuggestionOutput": str(reverse_path),
                "reviewThresholds": {
                    "confidence": REVIEW_CONFIDENCE,
                    "requiresRationale": True,
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Merged entities: {len(incoming_entities)}")
    print(f"Accepted relations: {len(accepted_relations)}")
    print(f"Review relations: {len(review_relations)}")
    print(f"Alias candidates: {len(alias_candidates)}")
    print(f"Relation conflicts: {len(relation_conflicts)}")
    print(f"Reverse suggestions: {len(reverse_suggestions)}")
    print(f"Totals: {len(merged_entities)} entities, {len(merged_relations)} relations")
    print(f"Review total: {len(merged_review_relations)}")
    print(f"Wrote {summary_path}")


if __name__ == "__main__":
    main()
