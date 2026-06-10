# 图谱抽取设计

## Purpose

Build an evidence-anchored graph from candidate passages. The graph must remain traceable to the novel text.

## Default deterministic layer

The bundled script extracts a conservative starter graph:
- `Chapter` nodes from retrieved chunks
- candidate `Character`, `Location`, `Artifact`, `Faction`, and `Concept` nodes from lexicon and surface patterns
- `APPEARS_IN` relations
- weak `CO_OCCURS_WITH` relations, marked `ambiguous`

This layer is not a substitute for literary interpretation. It is a stable substrate for later LLM or manual refinement.

Important:
- `APPEARS_IN` means the entity surface form appears in the candidate chunk.
- `CO_OCCURS_WITH` means two entities appear in the same retrieved chunk; it does not prove a plot relationship.
- For stronger relations, run LLM extraction only on retrieved candidate chunks and keep the same output schema.

## LLM enhancement rules

When using an LLM to extract stronger relations:
- only use retrieved candidate chunks or chapter ranges
- include exact evidence anchors
- classify edge source as `extracted`, `inferred`, or `ambiguous`
- keep `confidence` numeric
- do not create relation types outside ontology without updating `ontology.json`
- generate the task with `scripts/prepare_llm_relations.py`
- validate and merge with `scripts/merge_llm_relations.py`
- never write unvalidated free-form LLM output into `relations.jsonl`
- keep accepted facts in `relations` or `acceptedRelations`
- put uncertain facts in `reviewRelations`
- put possible same-entity names in `aliasCandidates`
- put mutually inconsistent claims in `relationConflicts`
- put useful but unaccepted inverse edges in `reverseRelationSuggestions`

## Strong relation workflow

1. Build retrieval:
   ```bash
   python3 scripts/build_retrieval.py --book "/path/to/book-output"
   ```
2. Prepare candidate chunks and schema:
   ```bash
   python3 scripts/prepare_llm_relations.py --book "/path/to/book-output" --query "谁参与了小镇相关事件"
   ```
3. Ask an LLM to fill `graph/llm-relation-task.json` according to its `outputSchema`.
4. Save the LLM result as JSON.
5. Validate and merge:
   ```bash
   python3 scripts/merge_llm_relations.py --book "/path/to/book-output" --input "/path/to/llm-output.json"
   ```
6. Validate graph and content assets:
   ```bash
   python3 scripts/validate_content_assets.py --book "/path/to/book-output"
   ```

Merge outputs:
- accepted relations -> `graph/relations.jsonl`
- review relations -> `graph/review-relations.jsonl`
- alias candidates -> `graph/alias-candidates.jsonl`
- confirmed aliases -> `graph/aliases.jsonl`
- relation conflicts -> `graph/relation-conflicts.jsonl`
- reverse relation suggestions -> `graph/reverse-relation-suggestions.jsonl`

Only `graph/relations.jsonl` is treated as accepted relation fact. Confirmed aliases in `graph/aliases.jsonl` are accepted identity metadata, but they do not rewrite existing entity IDs or relation endpoints. The other files are review queues.

Allowed strong relation types:
- `PARTICIPATES_IN`: Character -> Event
- `OCCURS_IN`: Event -> Location
- `OWNS_OR_USES`: Character -> Artifact
- `BELONGS_TO`: Character -> Faction
- `MENTORS`: Character -> Character
- `DISCIPLE_OF`: Character -> Character
- `FELLOW_DISCIPLE_OF`: Character -> Character
- `LINEAGE_OF`: Character -> Faction/Concept
- `FRIEND_OF`: Character -> Character
- `OPPOSES`: Character/Faction -> Character/Faction
- `RELATED_TO`: use sparingly; requires rationale

## Required relation fields

```json
{
  "id": "rel-...",
  "sourceId": "character:陈平安",
  "targetId": "chapter:jianlai-chapter-0001",
  "type": "APPEARS_IN",
  "bookSlug": "jianlai",
  "chapterId": "jianlai-chapter-0001",
  "lineStart": 14,
  "lineEnd": 31,
  "source": "extracted",
  "confidence": 0.8,
  "evidenceText": "..."
}
```
