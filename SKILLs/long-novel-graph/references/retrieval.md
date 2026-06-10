# 检索层设计

## Purpose

Map a user's question to candidate chapters and passages. The retrieval layer does not answer the question by itself; it returns evidence anchors for later reasoning.

## Default outputs

```text
chunks.jsonl
search.sqlite
```

Each chunk must include:

```json
{
  "chunkId": "jianlai-chunk-000001",
  "bookSlug": "jianlai",
  "chapterId": "jianlai-chapter-0001",
  "volume": "第一卷 笼中雀",
  "chapter": "第一章 惊蛰",
  "lineStart": 14,
  "lineEnd": 31,
  "text": "..."
}
```

## Chinese search

SQLite FTS5 does not provide robust Chinese word segmentation by default. The script therefore stores a generated `searchText` field containing overlapping Chinese n-grams. Query terms are converted the same way before BM25 search.

The query script also applies a lightweight rerank:
- exact term hits are weighted above raw BM25 rank
- event intent terms such as `第一次`, `首次`, `离开`, `走出`, `家乡`, and `小镇` receive extra weight
- confirmed aliases from `graph/aliases.jsonl` are expanded when the query mentions a canonical name or alias
- results are still candidate passages, not final answers

## Confirmed alias expansion

`query_retrieval.py` reads only confirmed aliases from `graph/aliases.jsonl`.
It does not use `alias-candidates.jsonl`, because candidates are pending review.

When the query contains any name in a confirmed alias group, the whole group is added to the FTS terms. Example:

```text
老秀才 / 文圣 / 荀卿
刘十六 / 君倩
```

This improves recall for alternate names, titles, and honorifics. It does not merge source text or create new graph facts. The JSON output includes `expandedAliases` so the caller can see which alias group changed the query.

For very large books, `search.sqlite` may become hundreds of MB. Treat it as a rebuildable cache.

## Embeddings

Embeddings are optional. If added later:
- keep vectors outside `manifest.json`
- record model name and dimension
- never return a vector hit without `chapterId + lineStart + lineEnd`
- prefer local rebuildable vector stores over opaque remote state
