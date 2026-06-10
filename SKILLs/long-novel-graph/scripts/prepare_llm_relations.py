#!/usr/bin/env python3
import argparse
import importlib.util
import json
from pathlib import Path


ENTITY_TYPES = ["Character", "Location", "Faction", "Artifact", "Event", "Concept"]
RELATION_TYPES = [
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
]


def read_jsonl(path: Path):
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def read_lines(path: Path):
    return path.read_text(encoding="utf-8").splitlines()


def read_chapter_ids(path: Path):
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_query_module():
    script_dir = Path(__file__).resolve().parent
    module_path = script_dir / "query_retrieval.py"
    spec = importlib.util.spec_from_file_location("query_retrieval", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def output_schema():
    relation_schema = {
        "sourceId": "character:陈平安",
        "targetId": "event:护送李宝瓶去大隋求学",
        "type": "PARTICIPATES_IN",
        "bookSlug": "jianlai",
        "chapterId": "jianlai-chapter-0001",
        "lineStart": 1,
        "lineEnd": 2,
        "source": "extracted",
        "confidence": 0.8,
        "evidenceText": "原文证据短句",
        "rationale": "为什么这条关系由证据支持",
    }
    return {
        "entities": [
            {
                "id": "character:陈平安",
                "type": "Character",
                "name": "陈平安",
                "chapterId": "jianlai-chapter-0001",
                "lineStart": 1,
                "lineEnd": 2,
                "source": "extracted",
                "confidence": 0.8,
                "evidenceText": "原文证据短句",
            }
        ],
        "relations": [
            relation_schema,
        ],
        "reviewRelations": [
            {
                **relation_schema,
                "confidence": 0.55,
                "reviewReasons": ["low_confidence", "alias_uncertain"],
            }
        ],
        "aliasCandidates": [
            {
                "canonicalEntityId": "character:陈平安",
                "candidateEntityId": "character:泥瓶巷少年",
                "candidateName": "泥瓶巷少年",
                "entityType": "Character",
                "bookSlug": "jianlai",
                "chapterId": "jianlai-chapter-0001",
                "lineStart": 1,
                "lineEnd": 2,
                "source": "extracted",
                "confidence": 0.7,
                "evidenceText": "原文证据短句",
                "rationale": "为什么它可能是同一实体",
            }
        ],
        "relationConflicts": [
            {
                "relation": relation_schema,
                "conflictsWith": {
                    "sourceId": "character:陈平安",
                    "targetId": "faction:大骊",
                    "type": "BELONGS_TO",
                },
                "conflictReason": "证据不足以同时支持两种归属或关系方向",
            }
        ],
        "reverseRelationSuggestions": [
            {
                "relation": relation_schema,
                "suggestedReverseType": "PARTICIPATES_IN",
                "reason": "同一事件通常也应连接另一位参与者，但仍需证据确认",
            }
        ],
    }


def chunk_from_chapter(book_dir: Path, chapter: dict, lines: list[str]):
    text = "\n".join(lines[int(chapter["lineStart"]) - 1 : int(chapter["lineEnd"])])
    snippet = text.replace("\n", " ")[:260]
    if len(text) > 260:
        snippet += "..."
    return {
        "chunkId": f"{chapter['id']}:full",
        "bookSlug": json.loads((book_dir / "manifest.json").read_text(encoding="utf-8")).get("slug"),
        "chapterId": chapter["id"],
        "volume": chapter.get("volume"),
        "chapter": chapter.get("heading"),
        "lineStart": chapter["lineStart"],
        "lineEnd": chapter["lineEnd"],
        "snippet": snippet,
        "text": text,
    }


def candidates_from_chapter_list(book_dir: Path, chapter_list_path: Path):
    chapter_ids = read_chapter_ids(chapter_list_path)
    chapters = {item["id"]: item for item in read_jsonl(book_dir / "chapters.jsonl")}
    lines = read_lines(book_dir / "corpus" / "book.txt")
    candidates = []
    for chapter_id in chapter_ids:
        chapter = chapters.get(chapter_id)
        if not chapter:
            raise SystemExit(f"Unknown chapter id in chapter list: {chapter_id}")
        candidates.append(chunk_from_chapter(book_dir, chapter, lines))
    return candidates


def candidates_from_query(book_dir: Path, query: str, limit: int):
    query_module = load_query_module()
    _terms, results = query_module.search(book_dir, query, limit)
    return [
        {
            "chunkId": item["chunkId"],
            "bookSlug": item["bookSlug"],
            "chapterId": item["chapterId"],
            "volume": item.get("volume"),
            "chapter": item["chapter"],
            "lineStart": item["lineStart"],
            "lineEnd": item["lineEnd"],
            "snippet": item["snippet"],
            "text": item["text"],
        }
        for item in results
    ]


def main():
    parser = argparse.ArgumentParser(description="Prepare an evidence-bounded LLM relation extraction task.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--query")
    parser.add_argument("--chapter-list", help="Chapter id list from relation backlog or batch summary planning.")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--out", help="Defaults to <book>/graph/llm-relation-task.json.")
    args = parser.parse_args()
    if not args.query and not args.chapter_list:
        raise SystemExit("Provide --query or --chapter-list.")
    if args.query and args.chapter_list:
        raise SystemExit("Use only one of --query or --chapter-list.")

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((book_dir / "manifest.json").read_text(encoding="utf-8"))
    if args.chapter_list:
        candidates = candidates_from_chapter_list(book_dir, Path(args.chapter_list).resolve())
        query = f"chapter-list:{Path(args.chapter_list).name}"
    else:
        candidates = candidates_from_query(book_dir, args.query, args.limit)
        query = args.query

    task = {
        "task": "Extract strong semantic relations from the candidate passages only.",
        "rules": [
            "Only use facts supported by candidate passages in this file.",
            "Do not use memory or outside knowledge about the novel.",
            "Every entity and relation must include chapterId, lineStart, lineEnd, source, confidence, and evidenceText.",
            "lineStart and lineEnd must stay within one of the candidate chunk line ranges.",
            "Use source=extracted when directly supported; source=inferred only for a necessary local inference with rationale.",
            "Do not output relations not listed in allowedRelationTypes.",
            "Prefer fewer high-confidence relations over many weak relations.",
            "Put high-confidence supported relations in relations.",
            "Put low-confidence, ambiguous, missing-rationale, or alias-uncertain relations in reviewRelations.",
            "Put possible same-entity names in aliasCandidates; do not merge aliases yourself.",
            "Put mutually inconsistent claims in relationConflicts; do not choose one unless evidence is clear.",
            "Put useful inverse edges in reverseRelationSuggestions; they are suggestions, not accepted facts.",
        ],
        "book": {
            "title": manifest.get("title"),
            "slug": manifest.get("slug"),
            "sourceSha256": manifest.get("sourceSha256"),
        },
        "query": query,
        "inputMode": "chapter-list" if args.chapter_list else "query",
        "chapterList": str(Path(args.chapter_list).resolve()) if args.chapter_list else None,
        "allowedEntityTypes": ENTITY_TYPES,
        "allowedRelationTypes": RELATION_TYPES,
        "outputSchema": output_schema(),
        "candidateChunks": candidates,
    }

    out_path = Path(args.out).resolve() if args.out else graph_dir / "llm-relation-task.json"
    out_path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(candidates)} candidate chunks.")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
