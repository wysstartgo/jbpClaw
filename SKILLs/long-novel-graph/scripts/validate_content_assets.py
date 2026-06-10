#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


TEMPORAL_QUALIFIERS = {"current", "former", "later", "transition", "historical", "ambiguous"}


def read_jsonl(path: Path):
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                rows.append({"__invalidJson": True, "lineNumber": line_number, "error": str(exc)})
    return rows


def chapter_ranges(book_dir: Path):
    return {
        item["id"]: {
            "lineStart": int(item["lineStart"]),
            "lineEnd": int(item["lineEnd"]),
            "heading": item.get("heading"),
        }
        for item in read_jsonl(book_dir / "chapters.jsonl")
    }


def check_anchor(item: dict, chapters: dict, label: str, errors: list[dict], warnings: list[dict]):
    if item.get("__invalidJson"):
        errors.append({"kind": "invalid_json", "label": label, **item})
        return
    chapter_id = item.get("chapterId")
    line_start = item.get("lineStart")
    line_end = item.get("lineEnd")
    if not chapter_id or line_start is None or line_end is None:
        errors.append({"kind": "missing_anchor", "label": label, "item": item})
        return
    if chapter_id not in chapters:
        errors.append({"kind": "unknown_chapter", "label": label, "chapterId": chapter_id})
        return
    try:
        line_start = int(line_start)
        line_end = int(line_end)
    except (TypeError, ValueError):
        errors.append({"kind": "invalid_line_number", "label": label, "item": item})
        return
    allowed = chapters[chapter_id]
    if not (allowed["lineStart"] <= line_start <= line_end <= allowed["lineEnd"]):
        errors.append(
            {
                "kind": "anchor_out_of_range",
                "label": label,
                "chapterId": chapter_id,
                "lineStart": line_start,
                "lineEnd": line_end,
                "allowed": allowed,
            }
        )
    evidence_text = str(item.get("evidenceText", "")).strip()
    if "evidenceText" in item and len(evidence_text) < 6:
        warnings.append({"kind": "short_evidence", "label": label, "chapterId": chapter_id, "evidenceText": evidence_text})


def check_entity_evidence(entities: list[dict], chapters: dict, errors: list[dict], warnings: list[dict]):
    entity_ids = set()
    for entity in entities:
        if entity.get("__invalidJson"):
            errors.append({"kind": "invalid_json", "label": "entity", **entity})
            continue
        entity_id = entity.get("id")
        if not entity_id:
            errors.append({"kind": "missing_entity_id", "entity": entity})
            continue
        entity_ids.add(entity_id)
        for evidence in entity.get("evidence", []):
            check_anchor(evidence, chapters, f"entity:{entity_id}", errors, warnings)
    return entity_ids


def check_relations(relations: list[dict], chapters: dict, entity_ids: set[str], label: str, errors: list[dict], warnings: list[dict]):
    relation_ids = set()
    for relation in relations:
        if relation.get("__invalidJson"):
            errors.append({"kind": "invalid_json", "label": label, **relation})
            continue
        relation_id = relation.get("id")
        if not relation_id:
            errors.append({"kind": "missing_relation_id", "label": label, "relation": relation})
        elif relation_id in relation_ids:
            warnings.append({"kind": "duplicate_relation_id", "label": label, "id": relation_id})
        relation_ids.add(relation_id)
        for endpoint in ("sourceId", "targetId"):
            if relation.get(endpoint) not in entity_ids:
                errors.append({"kind": "unknown_relation_endpoint", "label": label, "endpoint": endpoint, "id": relation.get(endpoint)})
        check_anchor(relation, chapters, label, errors, warnings)
        temporal_qualifier = relation.get("temporalQualifier")
        if temporal_qualifier is not None and temporal_qualifier not in TEMPORAL_QUALIFIERS:
            errors.append({"kind": "invalid_temporal_qualifier", "label": label, "id": relation_id, "temporalQualifier": temporal_qualifier})
        for chapter_key in ("validFromChapterId", "validToChapterId"):
            chapter_id = relation.get(chapter_key)
            if chapter_id is not None and chapter_id not in chapters:
                errors.append({"kind": "unknown_temporal_chapter", "label": label, "id": relation_id, "field": chapter_key, "chapterId": chapter_id})
        if relation.get("status") is not None and not str(relation.get("status")).strip():
            errors.append({"kind": "empty_relation_status", "label": label, "id": relation_id})


def check_summaries(summaries: list[dict], chapters: dict, errors: list[dict], warnings: list[dict]):
    seen = set()
    for summary in summaries:
        chapter_id = summary.get("chapterId")
        if chapter_id in seen:
            warnings.append({"kind": "duplicate_summary", "chapterId": chapter_id})
        seen.add(chapter_id)
        check_anchor(summary, chapters, "summary", errors, warnings)
        if not str(summary.get("summary", "")).strip():
            errors.append({"kind": "empty_summary", "chapterId": chapter_id})


def check_events(events: list[dict], chapters: dict, errors: list[dict], warnings: list[dict]):
    seen = set()
    for event in events:
        event_id = event.get("eventId")
        if not event_id:
            errors.append({"kind": "missing_event_id", "event": event})
        elif event_id in seen:
            warnings.append({"kind": "duplicate_event_id", "eventId": event_id})
        seen.add(event_id)
        check_anchor(event, chapters, "event", errors, warnings)


def check_characters(characters: list[dict], chapters: dict, entity_ids: set[str], errors: list[dict], warnings: list[dict]):
    for character in characters:
        character_id = character.get("characterId")
        if character_id not in entity_ids:
            errors.append({"kind": "unknown_character_entity", "characterId": character_id})
        first_seen = character.get("firstSeen") or {}
        if first_seen:
            check_anchor(first_seen, chapters, f"character-first-seen:{character_id}", errors, warnings)
        for key in ("strongRelations", "appearances", "reviewCandidates"):
            for relation in character.get(key, []):
                check_anchor(relation, chapters, f"character-{key}:{character_id}", errors, warnings)


def check_alias_candidates(alias_candidates: list[dict], aliases: list[dict], chapters: dict, entity_ids: set[str], errors: list[dict], warnings: list[dict]):
    seen = set()
    confirmed_alias_pairs = {
        (alias.get("canonicalEntityId"), alias.get("aliasEntityId"))
        for alias in aliases
    }
    for candidate in alias_candidates:
        alias_id = candidate.get("id")
        if not alias_id:
            errors.append({"kind": "missing_alias_candidate_id", "candidate": candidate})
        elif alias_id in seen:
            warnings.append({"kind": "duplicate_alias_candidate_id", "id": alias_id})
        seen.add(alias_id)
        canonical_id = candidate.get("canonicalEntityId")
        if canonical_id not in entity_ids:
            errors.append({"kind": "unknown_alias_canonical_entity", "canonicalEntityId": canonical_id})
        candidate_id = candidate.get("candidateEntityId")
        if candidate_id in entity_ids and (canonical_id, candidate_id) not in confirmed_alias_pairs:
            warnings.append({"kind": "alias_candidate_already_entity", "candidateEntityId": candidate_id})
        if not str(candidate.get("rationale", "")).strip():
            errors.append({"kind": "missing_alias_rationale", "id": alias_id})
        check_anchor(candidate, chapters, "alias-candidate", errors, warnings)


def check_aliases(aliases: list[dict], chapters: dict, entity_ids: set[str], errors: list[dict], warnings: list[dict]):
    seen = set()
    for alias in aliases:
        alias_id = alias.get("id")
        if not alias_id:
            errors.append({"kind": "missing_alias_id", "alias": alias})
        elif alias_id in seen:
            warnings.append({"kind": "duplicate_alias_id", "id": alias_id})
        seen.add(alias_id)
        canonical_id = alias.get("canonicalEntityId")
        if canonical_id not in entity_ids:
            errors.append({"kind": "unknown_alias_canonical_entity", "canonicalEntityId": canonical_id})
        if not str(alias.get("aliasName", "")).strip():
            errors.append({"kind": "missing_alias_name", "id": alias_id})
        if not str(alias.get("rationale", "")).strip():
            errors.append({"kind": "missing_alias_rationale", "id": alias_id})
        check_anchor(alias, chapters, "alias", errors, warnings)


def check_relation_conflicts(conflicts: list[dict], chapters: dict, entity_ids: set[str], errors: list[dict], warnings: list[dict]):
    seen = set()
    for conflict in conflicts:
        conflict_id = conflict.get("id")
        if not conflict_id:
            errors.append({"kind": "missing_relation_conflict_id", "conflict": conflict})
        elif conflict_id in seen:
            warnings.append({"kind": "duplicate_relation_conflict_id", "id": conflict_id})
        seen.add(conflict_id)
        relation = conflict.get("relation") or {}
        check_anchor(relation, chapters, "relation-conflict", errors, warnings)
        for endpoint in ("sourceId", "targetId"):
            if relation.get(endpoint) not in entity_ids:
                errors.append({"kind": "unknown_conflict_relation_endpoint", "endpoint": endpoint, "id": relation.get(endpoint)})
        if not str(conflict.get("conflictReason", "")).strip():
            errors.append({"kind": "missing_conflict_reason", "id": conflict_id})


def check_reverse_suggestions(suggestions: list[dict], chapters: dict, entity_ids: set[str], errors: list[dict], warnings: list[dict]):
    seen = set()
    for suggestion in suggestions:
        suggestion_id = suggestion.get("id")
        if not suggestion_id:
            errors.append({"kind": "missing_reverse_suggestion_id", "suggestion": suggestion})
        elif suggestion_id in seen:
            warnings.append({"kind": "duplicate_reverse_suggestion_id", "id": suggestion_id})
        seen.add(suggestion_id)
        relation = suggestion.get("relation") or {}
        check_anchor(relation, chapters, "reverse-suggestion", errors, warnings)
        for endpoint in ("sourceId", "targetId"):
            if relation.get(endpoint) not in entity_ids:
                errors.append({"kind": "unknown_reverse_suggestion_endpoint", "endpoint": endpoint, "id": relation.get(endpoint)})
        if not str(suggestion.get("reason", "")).strip():
            errors.append({"kind": "missing_reverse_suggestion_reason", "id": suggestion_id})


def main():
    parser = argparse.ArgumentParser(description="Validate evidence anchors and references for content assets.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--out", help="Defaults to <book>/graph/content-assets-validation.json.")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    chapters = chapter_ranges(book_dir)
    entities = read_jsonl(graph_dir / "entities.jsonl")
    relations = read_jsonl(graph_dir / "relations.jsonl")
    review_relations = read_jsonl(graph_dir / "review-relations.jsonl")
    summaries = read_jsonl(book_dir / "chapter-summaries.jsonl")
    events = read_jsonl(book_dir / "events.jsonl")
    characters = read_jsonl(book_dir / "characters.jsonl")
    alias_candidates = read_jsonl(graph_dir / "alias-candidates.jsonl")
    aliases = read_jsonl(graph_dir / "aliases.jsonl")
    relation_conflicts = read_jsonl(graph_dir / "relation-conflicts.jsonl")
    reverse_suggestions = read_jsonl(graph_dir / "reverse-relation-suggestions.jsonl")

    errors = []
    warnings = []
    entity_ids = check_entity_evidence(entities, chapters, errors, warnings)
    check_relations(relations, chapters, entity_ids, "relation", errors, warnings)
    check_relations(review_relations, chapters, entity_ids, "review-relation", errors, warnings)
    check_summaries(summaries, chapters, errors, warnings)
    check_events(events, chapters, errors, warnings)
    check_characters(characters, chapters, entity_ids, errors, warnings)
    check_alias_candidates(alias_candidates, aliases, chapters, entity_ids, errors, warnings)
    check_aliases(aliases, chapters, entity_ids, errors, warnings)
    check_relation_conflicts(relation_conflicts, chapters, entity_ids, errors, warnings)
    check_reverse_suggestions(reverse_suggestions, chapters, entity_ids, errors, warnings)

    report = {
        "ok": not errors,
        "counts": {
            "chapters": len(chapters),
            "entities": len(entities),
            "relations": len(relations),
            "reviewRelations": len(review_relations),
            "summaries": len(summaries),
            "events": len(events),
            "characters": len(characters),
            "aliasCandidates": len(alias_candidates),
            "aliases": len(aliases),
            "relationConflicts": len(relation_conflicts),
            "reverseRelationSuggestions": len(reverse_suggestions),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "errors": errors,
        "warnings": warnings,
    }
    out_path = Path(args.out).resolve() if args.out else graph_dir / "content-assets-validation.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK: {report['ok']}")
    print(f"Errors: {len(errors)}")
    print(f"Warnings: {len(warnings)}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
