---
name: long-novel-graph
description: Use when importing long-form Chinese novels or books from TXT files, building chapter indexes, locating user questions back to chapter/line evidence, and preparing evidence-anchored knowledge graphs with optional graphify and ontology-schema outputs.
---

# Long Novel Graph

Use this skill when the user wants to import a long novel/book, split it by chapters, quickly locate answers in the source text, or build a knowledge graph that can trace every entity and relationship back to chapter and line evidence.

## Core rule

Always plan before action. For a new book, first write or update a short方案 section that states:

- source file path and encoding assumption
- output directory
- chapter-title pattern
- whether the current step is indexing, locating, retrieval enhancement, or graph extraction
- validation command

Do not run expensive semantic extraction or graphify on a full long novel until deterministic chapter indexing and locator checks pass.

## Default workflow

1. **Inspect source**
   - Confirm the file exists and detect encoding.
   - Use read-only commands first.
   - Do not copy the full book into the repo unless the user explicitly asks.

2. **Initialize book workspace**
   - Run `scripts/init_book.mjs` with the source path.
   - Use a stable slug such as `jianlai`, `sanguo`, or a user-provided slug.
   - Prefer ignored local output directories such as `data/novel-index/<slug>/`.

3. **Build chapter index**
   - Run `scripts/build_index.mjs`.
   - Produce `manifest.json`, `chapters.jsonl`, and `chapters.md`.
   - Validate chapter count and first/last chapters.

4. **Locate user questions**
   - Run `scripts/locate.mjs --book <book-dir> "<query>"`.
   - Return chapter, volume, line number, score, and short evidence snippets.
   - Treat the result as candidate evidence, not final literary analysis.

5. **Build retrieval layer**
   - Run `scripts/build_retrieval.py --book <book-dir>`.
   - This creates `chunks.jsonl` and `search.sqlite`.
   - Query with `scripts/query_retrieval.py --book <book-dir> "<question>"`.
   - After confirmed aliases exist in `graph/aliases.jsonl`, retrieval automatically expands matching aliases, such as `文圣 / 老秀才 / 荀卿`.
   - Prefer SQLite FTS5 / BM25 before embeddings; embeddings are optional and must still return evidence anchors.

6. **Prepare graph layer only after retrieval works**
   - Read `references/ontology-schema.md`.
   - Run `scripts/extract_graph.py --book <book-dir> --query "<question>"` to extract from retrieved candidate chunks.
   - Before claiming a character graph is complete, run `scripts/entity_coverage_audit.py` for important characters or lineages.
   - For full-book character graphs, convert coverage gaps into extraction batches with `scripts/relation_backlog_plan.py`.
   - For strong semantic relations, run `scripts/prepare_llm_relations.py --book <book-dir> --query "<question>"`, have an LLM fill the JSON output, then validate with `scripts/merge_llm_relations.py`.
   - Keep `reviewRelations`, `aliasCandidates`, `relationConflicts`, and `reverseRelationSuggestions` separate from accepted `relations`.
   - Promote reviewed alias candidates with `scripts/promote_alias_candidate.py`; confirmed aliases go to `graph/aliases.jsonl`.
   - Query accepted graph relations by name or confirmed alias with `scripts/query_graph.py --book <book-dir> --name "<人物或别名>"`.
   - When a relation changes over time, keep the relation type stable and add optional temporal fields such as `temporalQualifier`, `status`, and `statusNote`; do not invent book-specific relation types for former/current/later states.
   - Run `scripts/render_graph_html.py --book <book-dir>` to create `graph/graph.html`.
   - Only then consider graphify on structured intermediate files.

7. **Build content assets when the graph needs better reading context**
   - Run `scripts/prepare_chapter_summary.py --book <book-dir> --query "<question>"` to create `graph/chapter-summary-task.json`.
   - Fill the summary JSON using an LLM or manual extraction, then validate with `scripts/merge_chapter_summary.py`.
   - For batch work, first run `scripts/batch_summary_plan.py` to create chapter-list files, then pass each `--chapter-list` into `prepare_chapter_summary.py`; use `--overwrite` only when intentionally regenerating existing summaries.
   - Inspect `graph/chapter-summary-quality-report.json` after merging.
   - Run `scripts/build_content_assets.py --book <book-dir>` to create `events.jsonl` and `characters.jsonl`.
   - Run `scripts/validate_content_assets.py --book <book-dir>` before treating content assets as accepted.
   - Re-render `graph.html`.

## Scripts

Use bundled scripts from this skill directory:

```bash
node scripts/init_book.mjs --source "/path/to/book.txt" --out "/path/to/output/book-slug" --title "书名"
node scripts/build_index.mjs --source "/path/to/book.txt" --out "/path/to/output/book-slug" --title "书名"
node scripts/locate.mjs --book "/path/to/output/book-slug" "人物 地点 事件"
python3 scripts/build_retrieval.py --book "/path/to/output/book-slug"
python3 scripts/query_retrieval.py --book "/path/to/output/book-slug" "自然语言问题"
python3 scripts/extract_graph.py --book "/path/to/output/book-slug" --query "自然语言问题"
python3 scripts/query_graph.py --book "/path/to/output/book-slug" --name "人物或别名"
python3 scripts/query_graph.py --book "/path/to/output/book-slug" --name "人物或别名" --relation-type DISCIPLE_OF --include-review
python3 scripts/query_graph.py --book "/path/to/output/book-slug" --name "人物或别名" --relation-type LINEAGE_OF --markdown
python3 scripts/entity_coverage_audit.py --book "/path/to/output/book-slug" --preset jianlai-wensheng
python3 scripts/entity_coverage_audit.py --book "/path/to/output/book-slug" --target "人物名|别名1|别名2"
python3 scripts/relation_backlog_plan.py --book "/path/to/output/book-slug" --group "文圣一脉" --batch-size 6 --limit-per-target 24
python3 scripts/prepare_llm_relations.py --book "/path/to/output/book-slug" --query "自然语言问题"
python3 scripts/prepare_llm_relations.py --book "/path/to/output/book-slug" --chapter-list "/path/to/relation-backlog-batches/崔瀺-batch-0001.txt" --out "/path/to/output/book-slug/graph/llm-relation-task.崔瀺-batch-0001.json"
python3 scripts/merge_llm_relations.py --book "/path/to/output/book-slug" --input "/path/to/llm-output.json"
python3 scripts/prepare_chapter_summary.py --book "/path/to/output/book-slug" --query "自然语言问题"
python3 scripts/batch_summary_plan.py --book "/path/to/output/book-slug" --batch-size 5 --start-chapter-id "chapter-0001" --end-chapter-id "chapter-0050"
python3 scripts/prepare_chapter_summary.py --book "/path/to/output/book-slug" --chapter-list "/path/to/chapter-list.txt" --overwrite
python3 scripts/merge_chapter_summary.py --book "/path/to/output/book-slug" --input "/path/to/summary-output.json"
python3 scripts/build_content_assets.py --book "/path/to/output/book-slug"
python3 scripts/validate_content_assets.py --book "/path/to/output/book-slug"
python3 scripts/promote_review_relation.py --book "/path/to/output/book-slug" --relation-id "rel:..." --rationale "人工审阅确认：..."
python3 scripts/promote_alias_candidate.py --book "/path/to/output/book-slug" --alias-id "alias:..." --rationale "人工审阅确认：..." --evidence-chapter-id "chapter-0001" --evidence-line-start 1 --evidence-line-end 2 --evidence-text "原文证据"
python3 scripts/render_graph_html.py --book "/path/to/output/book-slug"
```

If running from outside the skill directory, use absolute script paths.

## Output contract

Each book workspace should contain:

```text
manifest.json
chapters.jsonl
chapters.md
corpus/book.txt -> original source symlink when possible
```

Later graph stages may add:

```text
chunks.jsonl
search.sqlite
graph/ontology.json
graph/entities.jsonl
graph/relations.jsonl
graph/summary.json
graph/llm-relation-task.json
graph/review-relations.jsonl
graph/alias-candidates.jsonl
graph/aliases.jsonl
graph/relation-conflicts.jsonl
graph/reverse-relation-suggestions.jsonl
graph/aliases.jsonl
graph/entity-coverage-audit.json
graph/entity-coverage-audit.md
graph/relation-backlog-plan.json
graph/relation-backlog-plan.md
graph/relation-backlog-batches/
graph/review-promotion-summary.json
graph/chapter-summary-batches.json
graph/chapter-summary-batches/
graph/chapter-summary-quality-report.json
graph/content-assets-validation.json
chapter-summaries.jsonl
events.jsonl
characters.jsonl
graph/graph.html
graph/graphify-out/
```

## graphify guidance

graphify is useful after the book has stable chapter and evidence anchors. Prefer feeding graphify structured intermediate files such as chapter summaries, entity tables, and relation tables. Avoid direct full-text semantic graph extraction for very long novels unless the user explicitly accepts cost, time, and noise.

## Ontology guidance

Use the lightweight schema in `references/ontology-schema.md` by default. If the user provides another ontology skill or schema, map it to the same evidence anchor contract instead of replacing the locator layer.

## Retrieval guidance

Read `references/retrieval.md` before changing retrieval behavior. The default retrieval path is:

1. chapter index
2. chunk JSONL with evidence anchors
3. SQLite FTS5 / BM25
4. optional embeddings

Do not present BM25 results as exact answers. Present them as candidate passages with chapter and line evidence.

When `graph/aliases.jsonl` exists, `query_retrieval.py` may expand confirmed aliases into the FTS query. This improves recall but still does not make BM25 results authoritative. Alias candidates are never used for expansion until promoted.

## Graph extraction guidance

Read `references/graph-extraction.md` before changing graph behavior. The default graph extraction script is a deterministic starter layer. It is intentionally conservative and should be replaced or supplemented by LLM extraction only after candidate chunks are retrieved.

Strong semantic relations such as `PARTICIPATES_IN`, `OWNS_OR_USES`, `BELONGS_TO`, `DISCIPLE_OF`, `FELLOW_DISCIPLE_OF`, `LINEAGE_OF`, and `FRIEND_OF` must go through `prepare_llm_relations.py` and `merge_llm_relations.py`. Do not paste free-form LLM claims directly into `relations.jsonl`.

For temporal or status-sensitive relations, prefer optional relation fields over new relation types. Use `temporalQualifier` for broad timing (`current`, `former`, `later`, `transition`, `historical`, `ambiguous`), `status` for a compact machine-readable label, and `statusNote` for the human explanation. These fields still require the normal evidence anchor contract.

Completeness is a separate claim from validity. Use `entity_coverage_audit.py` before saying a character, lineage, or faction relationship graph is complete. Keyword coverage is only an audit signal; it does not create accepted relations.

For full-book character graphs, use `relation_backlog_plan.py` to turn coverage gaps into bounded extraction batches. A backlog batch is a task plan, not graph truth. It should feed later chapter summary or LLM relation extraction steps.

Low-confidence, ambiguous, or missing-rationale semantic relations must stay in `graph/review-relations.jsonl` until reviewed. Promote a reviewed relation with `promote_review_relation.py`; do not hand-edit the main relation file.

Alias candidates, relation conflicts, and reverse relation suggestions are not accepted facts. Alias candidates stay in `graph/alias-candidates.jsonl` until reviewed. Confirmed aliases must be promoted with `promote_alias_candidate.py` into `graph/aliases.jsonl`; do not hand-edit alias data into character cards. Relation conflicts and reverse relation suggestions must stay in `graph/relation-conflicts.jsonl` and `graph/reverse-relation-suggestions.jsonl` until a later reviewed merge step explicitly accepts them.

Use `query_graph.py` for relationship lookup after graph extraction. It resolves confirmed aliases to a canonical entity group and returns accepted relations with evidence anchors. It can optionally include review relations, but review output is still not accepted truth. For near-symmetric relation types such as `FELLOW_DISCIPLE_OF`, the script may show reverse display rows without writing duplicate graph edges.

Use `query_graph.py --markdown` when the result should become a user-facing answer draft. The Markdown report still separates accepted relations from review relations and includes chapter/line evidence for each relation.

## Visualization guidance

Read `references/visualization.md` before changing graph rendering. The default visualization is `graph/graph.html`, a static zero-dependency HTML file. It is meant for quick inspection and evidence drill-down; use graphify later for richer community detection and graph analytics.

The visualization should expose accepted graph data and pending review data separately. The review panel reads `graph/review-relations.jsonl` and is for inspection only; promotion still belongs to `promote_review_relation.py`.

## Optimization guidance

When the user asks to improve the graph, read `references/optimization-plan.md`. Optimize in this order:

1. content organization: chapter summaries, events, character profiles
2. strong character relations: typed, evidence-anchored, validated relations
3. visualization: filters, character view, event timeline, evidence panel

For content organization, use the task/merge pattern. Do not write unvalidated LLM summaries directly into `chapter-summaries.jsonl`.

For character profiles, keep `strongRelations`, `appearances`, and `reviewCandidates` separate. Review candidates are not accepted facts.

For production batches, generate `graph/chapter-summary-batches.json`, process one batch at a time, run `validate_content_assets.py`, then re-render `graph.html`.

## Reporting

When finished, report:

- output directory
- generated files
- chapter count
- validation query result
- retrieval result count, if built
- graph entity/relation count, if extracted
- entity coverage audit summary, if completeness was discussed
- graph HTML path, if rendered
- content validation result, if content assets exist
- review relation count and promotion summary, if review workflow was used
- alias/conflict/reverse suggestion counts, if LLM relation normalization was used
- remaining risks or next stage
