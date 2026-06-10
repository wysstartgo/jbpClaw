# 小说图谱优化路线

Use this reference when the user asks to improve an existing long-novel graph beyond the basic locator and starter graph.

## Optimization tracks

### 1. Content organization

Add intermediate content assets:
- `chapter-summaries.jsonl`
- `events.jsonl`
- `characters.jsonl`

Rules:
- every summary/event/profile must include chapter and line evidence
- summarize by retrieved chapters first; do not summarize the whole book by default
- use `batch_summary_plan.py` when processing chapter ranges or volumes
- keep generated content separate from source text
- generate summary tasks with `prepare_chapter_summary.py`
- use `--chapter-list` or `--from-search-file` for batch preparation
- keep `--overwrite` explicit so existing summaries are not regenerated accidentally
- merge summaries only through `merge_chapter_summary.py`
- inspect `chapter-summary-quality-report.json` after each merge
- derive event and character assets with `build_content_assets.py`
- run `validate_content_assets.py` before reporting assets as accepted
- character profiles should prefer strong/non-ambiguous relations in their relationship list

Before improving a character or lineage graph, run `entity_coverage_audit.py` to measure coverage gaps. Treat missing mention chapters as extraction backlog; do not convert keyword mentions directly into strong relations.

For full-book character graphs, run `relation_backlog_plan.py` after the coverage audit. Prioritize batches with relation cues such as teacher/student, lineage, faction, and named-title terms. Process the backlog in small batches and rerun the coverage audit after each accepted merge.

### 2. Strong character relations

Extend beyond weak co-occurrence:
- `PARTICIPATES_IN`
- `OWNS_OR_USES`
- `BELONGS_TO`
- `MENTORS`
- `DISCIPLE_OF`
- `FELLOW_DISCIPLE_OF`
- `LINEAGE_OF`
- `FRIEND_OF`
- `OPPOSES`
- `RELATED_TO`

Quality rules:
- low confidence `< 0.65` should go to review
- `CO_OCCURS_WITH` should be hidden by default in visual views
- aliases must be proposed as review candidates, not merged automatically
- only confirmed aliases in `graph/aliases.jsonl` may be used for query-time entity grouping
- strong relations must pass `merge_llm_relations.py`
- review relations should stay in `review-relations.jsonl` until manually promoted
- manual promotion should use `promote_review_relation.py`, followed by content validation
- missing rationale is a review reason for semantic relations
- relation conflicts should stay in `relation-conflicts.jsonl`
- reverse relation suggestions should stay in `reverse-relation-suggestions.jsonl`

### 3. Visual improvement

Improve `graph.html` in this order:
1. relation type filters
2. hide/show weak relations
3. character-only relationship view
4. event timeline panel
5. evidence detail panel with rationale
6. read `events.jsonl` for timeline content when available
7. read `characters.jsonl` for character profile cards when available
8. show strong relations, appearances, and review candidates separately
9. make event participants and locations clickable when matching nodes exist
10. add a review panel for `review-relations.jsonl` so pending claims are visible but separate from accepted graph facts

Do not introduce a graph UI dependency until the static HTML is clearly insufficient.

### 4. Query-time graph lookup

Use `query_graph.py` when the user asks about a character, alias, lineage, or direct relationship after graph extraction has produced accepted relations.

Rules:
- resolve only confirmed aliases from `graph/aliases.jsonl`
- return accepted relations by default
- include review relations only when the caller explicitly asks for them
- keep `FELLOW_DISCIPLE_OF` as one accepted edge, but allow reverse display in query output
- do not write duplicate reverse edges into `relations.jsonl`
- keep every returned relation tied to `chapterId + lineStart + lineEnd + evidenceText`
- use `query_graph.py --markdown` when the query result should be pasted into a user-facing answer draft
- keep accepted and review relations separated in Markdown output

## Production batch checklist

For each strong-relation batch:
- refresh or select a chapter list with `relation_backlog_plan.py`
- prepare one relation task from that chapter list with `prepare_llm_relations.py --chapter-list`
- merge only validated LLM/manual output through `merge_llm_relations.py`
- keep accepted relations, review relations, alias candidates, relation conflicts, and reverse suggestions separated
- rebuild content assets
- run `validate_content_assets.py`
- render `graph.html`
- rerun `entity_coverage_audit.py` when completeness is being discussed
- record errors, warnings, accepted relation count, review relation count, and next batch scope
- record alias candidate, relation conflict, and reverse suggestion counts when strong relation extraction is used

For each content-summary batch:
- generate or select a chapter list with `batch_summary_plan.py`
- prepare one summary task from that chapter list
- merge only validated LLM/manual output
- rebuild content assets
- run `validate_content_assets.py`
- render `graph.html`
- record errors, warnings, accepted relation count, review relation count, and next batch scope
