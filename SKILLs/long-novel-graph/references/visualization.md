# 可视化层设计

## Purpose

Render `entities.jsonl` and `relations.jsonl` into a local `graph.html` so users can inspect the current evidence-anchored graph without running a server.

## Default output

```text
graph/graph.html
```

Open it directly in a browser.

## Interaction contract

The page should support:
- node type legend
- search by node name/type
- relation type filters
- hide/show weak `CO_OCCURS_WITH` relations
- view modes: all graph, character relations, event timeline, review relations
- character profile cards from `characters.jsonl`
- event timeline rows from `events.jsonl`
- review relation rows from `graph/review-relations.jsonl`
- grouped character relations: strong relations, appearances, review candidates
- clickable event participants and locations when matching nodes exist
- clickable review relation source and target when matching nodes exist
- click node to view evidence anchors
- click edge to view relation type, confidence, source, chapter id, line range, and evidence text

## Boundaries

This visualization is intentionally lightweight. It is not graphify:
- no community detection
- no persistent graph query engine
- no force simulation dependency

Use it to verify that graph data is meaningful before running graphify or building a richer UI.

## Defaults

- Hide `CO_OCCURS_WITH` by default.
- Keep `APPEARS_IN` visible for evidence navigation.
- Highlight strong relation types such as `PARTICIPATES_IN`, `OCCURS_IN`, `OWNS_OR_USES`, and `BELONGS_TO`.
- Event timeline should prefer `events.jsonl`; fall back to `Event` nodes and their connected relations.
- Character node details should prefer `characters.jsonl`; fall back to raw node evidence.
- Review candidates must be visually separated from accepted strong relations.
- Review panel is read-only. Use `promote_review_relation.py` after human review, then run `validate_content_assets.py` and render again.
