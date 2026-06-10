#!/usr/bin/env python3
import argparse
import json
import re
import sqlite3
from pathlib import Path


HAN_RE = re.compile(r"[\u4e00-\u9fff]+")
ASCII_RE = re.compile(r"[A-Za-z0-9_]{2,}")
STOP_WORDS = {
    "一个",
    "一下",
    "哪里",
    "哪章",
    "第几章",
    "发生",
    "出现",
    "时候",
    "什么",
    "怎么",
    "为什么",
    "请问",
    "用户",
    "问题",
    "小说",
    "位置",
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


def load_confirmed_alias_groups(book_dir: Path) -> list[dict]:
    aliases = read_jsonl(book_dir / "graph" / "aliases.jsonl")
    groups_by_canonical: dict[str, set[str]] = {}
    evidence_by_canonical: dict[str, list[dict]] = {}
    for alias in aliases:
        canonical_id = alias.get("canonicalEntityId")
        if not canonical_id:
            continue
        names = groups_by_canonical.setdefault(canonical_id, {entity_name(canonical_id)})
        alias_name = str(alias.get("aliasName", "")).strip()
        alias_entity_id = str(alias.get("aliasEntityId", "")).strip()
        if alias_name:
            names.add(alias_name)
        if alias_entity_id:
            names.add(entity_name(alias_entity_id))
        evidence_by_canonical.setdefault(canonical_id, []).append(
            {
                "aliasName": alias_name,
                "aliasEntityId": alias_entity_id,
                "chapterId": alias.get("chapterId"),
                "lineStart": alias.get("lineStart"),
                "lineEnd": alias.get("lineEnd"),
                "confidence": alias.get("confidence"),
            }
        )

    groups = []
    for canonical_id, names in groups_by_canonical.items():
        clean_names = sorted({name for name in names if name}, key=lambda value: (-len(value), value))
        if len(clean_names) < 2:
            continue
        groups.append(
            {
                "canonicalEntityId": canonical_id,
                "names": clean_names,
                "evidence": evidence_by_canonical.get(canonical_id, []),
            }
        )
    return groups


def expand_terms_with_aliases(book_dir: Path, question: str, terms: list[str]) -> tuple[list[str], list[dict]]:
    expanded = set(terms)
    matched_groups = []
    for group in load_confirmed_alias_groups(book_dir):
        names = group["names"]
        if not any(name and name in question for name in names):
            continue
        for name in names:
            expanded.add(name)
        matched_groups.append(group)
    return sorted(expanded, key=lambda value: (-len(value), value))[:48], matched_groups


def query_terms(text: str) -> list[str]:
    terms: set[str] = set(token.lower() for token in ASCII_RE.findall(text))
    for span in HAN_RE.findall(text):
        if 2 <= len(span) <= 12 and span not in STOP_WORDS:
            terms.add(span)
        for size in (3, 2):
            for index in range(0, max(0, len(span) - size + 1)):
                term = span[index : index + size]
                if term not in STOP_WORDS:
                    terms.add(term)
    return sorted(terms, key=lambda value: (-len(value), value))[:32]


def intent_terms(question: str) -> list[str]:
    terms = []
    for term in ("第一次", "首次", "初次", "离开", "走出", "出门", "远行", "家乡", "小镇"):
        if term in question:
            terms.append(term)
    for match in re.findall(r"[\u4e00-\u9fff]{2,4}", question):
        if match not in STOP_WORDS and match not in terms:
            terms.append(match)
    return terms[:12]


def quote_fts(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def make_match_query(terms: list[str]) -> str:
    if not terms:
        return ""
    return "search_text:(" + " OR ".join(quote_fts(term) for term in terms) + ")"


def make_snippet(text: str, terms: list[str]) -> str:
    compact = " ".join(line.strip() for line in text.splitlines() if line.strip())
    positions = [compact.find(term) for term in terms if compact.find(term) >= 0]
    if not positions:
        return compact[:180]
    hit = min(positions)
    start = max(0, hit - 70)
    end = min(len(compact), hit + 130)
    return f"{'...' if start else ''}{compact[start:end]}{'...' if end < len(compact) else ''}"


def search(book_dir: Path, question: str, limit: int):
    base_terms = query_terms(question)
    terms, _matched_alias_groups = expand_terms_with_aliases(book_dir, question, base_terms)
    priority_terms = intent_terms(question)
    match_query = make_match_query(terms)
    if not match_query:
        return terms, []

    connection = sqlite3.connect(book_dir / "search.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT
              chunk_id,
              book_slug,
              chapter_id,
              volume,
              chapter,
              line_start,
              line_end,
              text,
              bm25(chunk_fts) AS rank
            FROM chunk_fts
            WHERE chunk_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (match_query, max(limit * 4, limit)),
        ).fetchall()
    finally:
        connection.close()

    rescored = []
    for row in rows:
        text = row["text"]
        exact_score = sum(len(term) for term in terms if term in text)
        priority_score = sum(len(term) * 8 for term in priority_terms if term in text)
        rescored.append(
            {
                "chunkId": row["chunk_id"],
                "bookSlug": row["book_slug"],
                "chapterId": row["chapter_id"],
                "volume": row["volume"],
                "chapter": row["chapter"],
                "lineStart": row["line_start"],
                "lineEnd": row["line_end"],
                "rank": row["rank"],
                "exactScore": exact_score,
                "score": exact_score * 100 + priority_score * 100 - row["rank"],
                "snippet": make_snippet(text, terms),
                "text": text,
            }
        )

    rescored.sort(key=lambda item: (-item["score"], item["rank"]))
    return terms, rescored[:limit]


def main():
    parser = argparse.ArgumentParser(description="Query a long novel SQLite FTS5/BM25 retrieval index.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of human-readable text.")
    parser.add_argument("question", nargs="+")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    question = " ".join(args.question)
    terms, results = search(book_dir, question, args.limit)
    _expanded_terms, matched_alias_groups = expand_terms_with_aliases(book_dir, question, query_terms(question))

    if args.json:
        print(
            json.dumps(
                {
                    "query": question,
                    "terms": terms,
                    "expandedAliases": matched_alias_groups,
                    "results": results,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    print(f"查询：{question}")
    print(f"检索词：{' / '.join(terms) if terms else '无'}")
    if matched_alias_groups:
        print("别名扩展：")
        for group in matched_alias_groups:
            print(f"- {group['canonicalEntityId']}: {' / '.join(group['names'])}")
    print(f"候选片段：{len(results)}")
    for item in results:
        print("")
        print(f"- {item['chapter']} ({item['volume'] or '无卷名'}) L{item['lineStart']}-{item['lineEnd']} score={item['score']:.3f}")
        print(f"  chunkId={item['chunkId']} chapterId={item['chapterId']}")
        print(f"  {item['snippet']}")


if __name__ == "__main__":
    main()
