# 长篇小说导入工作流

## Stage 1: deterministic index

Run chapter indexing first. It is cheap, stable, and creates the evidence spine for everything else.

Validation checklist:
- source hash recorded
- first chapter looks correct
- last chapter looks correct
- chapter count is plausible
- line ranges do not overlap

## Stage 2: locator

Use locator results as candidates. For exact names, keyword search is usually enough. For fuzzy plot questions, add BM25 or vector search later.

## Stage 3: retrieval enhancement

Recommended order:

1. `chunks.jsonl`: paragraph or sliding-window chunks with chapter anchors
2. SQLite FTS5: local BM25 search
3. embeddings: optional semantic retrieval

Commands:

```bash
python3 scripts/build_retrieval.py --book "/path/to/book-output"
python3 scripts/query_retrieval.py --book "/path/to/book-output" "陈平安第一次离开小镇"
```

Validation checklist:
- `chunks.jsonl` exists
- `search.sqlite` exists
- query returns chunk id, chapter id, chapter title, line range, and snippet
- every result can be traced to source text

## Stage 4: graph

Extract graph from located chapters or structured summaries, not from the whole raw novel at once. Keep graph relations evidence-anchored.

Command:

```bash
python3 scripts/extract_graph.py --book "/path/to/book-output" --query "齐静春 小镇"
```

Validation checklist:
- `graph/ontology.json` exists
- `graph/entities.jsonl` exists
- `graph/relations.jsonl` exists
- every relation includes `chapterId`, `lineStart`, `lineEnd`, `source`, and `confidence`
- weak co-occurrence relations are marked as `ambiguous`, not `extracted`
- strong LLM extraction keeps review, alias, conflict, and reverse suggestions outside `graph/relations.jsonl`

## Stage 4.5: coverage audit

Use this stage before claiming that a character, lineage, or faction graph is complete.

Commands:

```bash
python3 scripts/entity_coverage_audit.py --book "/path/to/book-output" --preset jianlai-wensheng
python3 scripts/entity_coverage_audit.py --book "/path/to/book-output" --target "崔瀺|国师|大骊国师"
```

Validation checklist:
- `graph/entity-coverage-audit.json` exists
- `graph/entity-coverage-audit.md` exists
- report separates full-text mention chapters from current graph-covered chapters
- missing chapters are treated as extraction backlog, not accepted relations
- aliases are counted as candidate graph ids, but alias identity still requires review

## Stage 4.6: relation backlog planning

Use this stage to turn coverage gaps into bounded extraction batches for a full-book character graph.

Commands:

```bash
python3 scripts/relation_backlog_plan.py --book "/path/to/book-output" --group "文圣一脉" --batch-size 6 --limit-per-target 24
python3 scripts/relation_backlog_plan.py --book "/path/to/book-output" --target "崔瀺" --batch-size 6
```

Validation checklist:
- `graph/relation-backlog-plan.json` exists
- `graph/relation-backlog-plan.md` exists
- `graph/relation-backlog-batches/` contains chapter-list files
- each batch records target, chapter ids, relation cue hits, and next relation query
- backlog batches are not accepted graph facts

## Stage 4.7: batch relation extraction

Use this stage to execute one relation backlog batch.

Commands:

```bash
python3 scripts/prepare_llm_relations.py --book "/path/to/book-output" --chapter-list "/path/to/relation-backlog-batches/崔瀺-batch-0001.txt" --out "/path/to/book-output/graph/llm-relation-task.崔瀺-batch-0001.json"
python3 scripts/merge_llm_relations.py --book "/path/to/book-output" --task "/path/to/book-output/graph/llm-relation-task.崔瀺-batch-0001.json" --input "/path/to/llm-output.json"
python3 scripts/build_content_assets.py --book "/path/to/book-output"
python3 scripts/validate_content_assets.py --book "/path/to/book-output"
python3 scripts/render_graph_html.py --book "/path/to/book-output"
```

Validation checklist:
- task `inputMode` is `chapter-list`
- accepted lineage edges use precise relation types such as `DISCIPLE_OF`, `FELLOW_DISCIPLE_OF`, or `LINEAGE_OF`
- uncertain mentor/lineage claims stay in `review-relations.jsonl`
- uncertain aliases stay in `alias-candidates.jsonl`
- confirmed aliases are promoted to `aliases.jsonl` with `promote_alias_candidate.py`
- content assets are rebuilt after merge so character cards include new relations

## Stage 5: graphify

Use graphify on intermediate structured files:
- `chapter-summaries.md`
- `entities.jsonl`
- `relations.jsonl`
- `ontology.json`

Expected graphify outputs:
- `graph.html`
- `graph.json`
- `GRAPH_REPORT.md`

## Stage 6: content assets

Use this stage when the graph needs readable summaries, event rows, and character cards.

Commands:

```bash
python3 scripts/batch_summary_plan.py --book "/path/to/book-output" --batch-size 5 --start-chapter-id "chapter-0001" --end-chapter-id "chapter-0050"
python3 scripts/prepare_chapter_summary.py --book "/path/to/book-output" --query "陈平安第一次离开小镇"
python3 scripts/prepare_chapter_summary.py --book "/path/to/book-output" --chapter-list "/path/to/chapter-list.txt" --overwrite
python3 scripts/merge_chapter_summary.py --book "/path/to/book-output" --input "/path/to/summary-output.json"
python3 scripts/build_content_assets.py --book "/path/to/book-output"
python3 scripts/validate_content_assets.py --book "/path/to/book-output"
python3 scripts/render_graph_html.py --book "/path/to/book-output"
```

Validation checklist:
- `graph/chapter-summary-batches.json` records filters, skipped existing summaries, batch count, and chapter-list file paths
- `graph/chapter-summary-task.json` records candidate chapters and output schema
- `graph/chapter-summary-quality-report.json` records duplicate, low confidence, short evidence, and sparse asset warnings
- `graph/content-assets-validation.json` reports `ok`, errors, warnings, and asset counts
- `chapter-summaries.jsonl` has `chapterId`, `lineStart`, `lineEnd`, `source`, `confidence`, and `evidenceText`
- `events.jsonl` has event evidence anchors and participants when known
- `characters.jsonl` has first-seen evidence, `strongRelations`, `appearances`, and `reviewCandidates`
- `graph/graph.html` event view reads the event assets and character nodes show profile cards

## Stage 7: review relations

Use this stage when strong relation extraction produces low-confidence or incomplete claims.

Commands:

```bash
python3 scripts/promote_review_relation.py --book "/path/to/book-output" --relation-id "rel:..." --rationale "人工审阅确认：..."
python3 scripts/validate_content_assets.py --book "/path/to/book-output"
python3 scripts/render_graph_html.py --book "/path/to/book-output"
```

Rules:
- `merge_llm_relations.py` writes accepted relations into `graph/relations.jsonl`
- low-confidence, ambiguous, or missing-rationale relations go to `graph/review-relations.jsonl`
- alias candidates go to `graph/alias-candidates.jsonl`
- relation conflicts go to `graph/relation-conflicts.jsonl`
- reverse relation suggestions go to `graph/reverse-relation-suggestions.jsonl`
- do not hand-edit accepted graph relations to promote a review relation; use `promote_review_relation.py` or rerun validated merge after review
- `graph/review-promotion-summary.json` records the last real promotion when not using `--dry-run`
- re-run content validation after promotion because relation counts and character review candidates may change

## Stage 8: review aliases

Use this stage when an alias candidate has enough direct evidence.

Commands:

```bash
python3 scripts/promote_alias_candidate.py --book "/path/to/book-output" --alias-id "alias:..." --rationale "人工审阅确认：..." --evidence-chapter-id "chapter-0001" --evidence-line-start 1 --evidence-line-end 2 --evidence-text "原文证据"
python3 scripts/build_content_assets.py --book "/path/to/book-output"
python3 scripts/validate_content_assets.py --book "/path/to/book-output"
python3 scripts/render_graph_html.py --book "/path/to/book-output"
```

Rules:
- confirmed aliases go to `graph/aliases.jsonl`
- keep the original `alias-candidates.jsonl` entry as audit history
- do not rewrite entity IDs or existing relations during alias promotion
- character cards read `aliases.jsonl` after `build_content_assets.py`
