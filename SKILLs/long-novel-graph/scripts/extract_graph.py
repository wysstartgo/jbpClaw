#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import re
from collections import defaultdict
from pathlib import Path


ENTITY_PATTERNS = {
    "Character": [
        "陈平安",
        "齐静春",
        "宁姚",
        "宋集薪",
        "顾粲",
        "阮秀",
        "阿良",
        "李宝瓶",
        "崔瀺",
        "崔东山",
        "左右",
        "裴钱",
        "陆沉",
        "老秀才",
        "刘羡阳",
        "马苦玄",
    ],
    "Location": [
        "小镇",
        "骊珠洞天",
        "宝瓶洲",
        "桐叶洲",
        "剑气长城",
        "落魄山",
        "大骊",
        "正阳山",
        "风雷园",
        "白帝城",
        "山崖书院",
    ],
    "Artifact": [
        "飞剑",
        "养剑葫",
        "压衣刀",
        "蛇胆石",
        "槐木剑",
        "竹箱",
        "印章",
        "本命瓷",
    ],
    "Faction": [
        "文圣一脉",
        "儒家",
        "道家",
        "正阳山",
        "风雷园",
        "大骊",
    ],
    "Concept": [
        "练气士",
        "纯粹武夫",
        "十四境",
        "本命",
        "因果",
        "大道",
        "气运",
    ],
}


def load_query_module():
    script_dir = Path(__file__).resolve().parent
    module_path = script_dir / "query_retrieval.py"
    spec = importlib.util.spec_from_file_location("query_retrieval", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def stable_id(*parts: str) -> str:
    digest = hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()[:16]
    return digest


def add_entity(entities: dict, entity_type: str, name: str, item: dict):
    entity_id = f"{entity_type.lower()}:{name}"
    evidence = {
        "bookSlug": item["bookSlug"],
        "chapterId": item["chapterId"],
        "lineStart": item["lineStart"],
        "lineEnd": item["lineEnd"],
        "source": "extracted",
        "confidence": 0.75,
    }
    if entity_id not in entities:
        entities[entity_id] = {
            "id": entity_id,
            "type": entity_type,
            "name": name,
            "evidence": [evidence],
        }
    else:
        key = (evidence["chapterId"], evidence["lineStart"], evidence["lineEnd"])
        seen = {
            (entry["chapterId"], entry["lineStart"], entry["lineEnd"])
            for entry in entities[entity_id]["evidence"]
        }
        if key not in seen:
            entities[entity_id]["evidence"].append(evidence)
    return entity_id


def relation(source_id: str, target_id: str, rel_type: str, item: dict, source: str, confidence: float, evidence_text: str):
    rel_id = f"rel:{stable_id(source_id, target_id, rel_type, item['chapterId'], str(item['lineStart']), str(item['lineEnd']))}"
    return {
        "id": rel_id,
        "sourceId": source_id,
        "targetId": target_id,
        "type": rel_type,
        "bookSlug": item["bookSlug"],
        "chapterId": item["chapterId"],
        "lineStart": item["lineStart"],
        "lineEnd": item["lineEnd"],
        "source": source,
        "confidence": confidence,
        "evidenceText": evidence_text,
    }


def detect_entities(text: str):
    detected = []
    for entity_type, names in ENTITY_PATTERNS.items():
        for name in names:
            if name in text:
                detected.append((entity_type, name))
    return detected


def write_jsonl(path: Path, rows):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def ontology():
    return {
        "entityTypes": [
            "Book",
            "Volume",
            "Chapter",
            "Character",
            "Location",
            "Faction",
            "Artifact",
            "Event",
            "Concept",
        ],
        "relationTypes": [
            "CONTAINS",
            "APPEARS_IN",
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
            "CO_OCCURS_WITH",
        ],
        "evidenceRequired": ["bookSlug", "chapterId", "lineStart", "lineEnd", "source", "confidence"],
    }


def main():
    parser = argparse.ArgumentParser(description="Extract an evidence-anchored starter graph from retrieved long-novel chunks.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--limit", type=int, default=12)
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    query_module = load_query_module()
    _terms, results = query_module.search(book_dir, args.query, args.limit)

    graph_dir = book_dir / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)

    entities = {}
    relations_by_id = {}
    chapter_entities: dict[str, set[str]] = defaultdict(set)

    for item in results:
        chapter_id = f"chapter:{item['chapterId']}"
        if chapter_id not in entities:
            entities[chapter_id] = {
                "id": chapter_id,
                "type": "Chapter",
                "name": item["chapter"],
                "evidence": [
                    {
                        "bookSlug": item["bookSlug"],
                        "chapterId": item["chapterId"],
                        "lineStart": item["lineStart"],
                        "lineEnd": item["lineEnd"],
                        "source": "extracted",
                        "confidence": 1.0,
                    }
                ],
            }

        detected = detect_entities(item["text"])
        for entity_type, name in detected:
            entity_id = add_entity(entities, entity_type, name, item)
            chapter_entities[item["chapterId"]].add(entity_id)
            rel = relation(
                entity_id,
                chapter_id,
                "APPEARS_IN",
                item,
                "extracted",
                0.8,
                item["snippet"],
            )
            relations_by_id[rel["id"]] = rel

        detected_ids = [f"{entity_type.lower()}:{name}" for entity_type, name in detected]
        for index, source_id in enumerate(detected_ids):
            for target_id in detected_ids[index + 1 :]:
                if source_id == target_id:
                    continue
                source_type = source_id.split(":", 1)[0]
                target_type = target_id.split(":", 1)[0]
                if source_type == "chapter" or target_type == "chapter":
                    continue
                rel = relation(
                    source_id,
                    target_id,
                    "CO_OCCURS_WITH",
                    item,
                    "ambiguous",
                    0.35,
                    item["snippet"],
                )
                relations_by_id[rel["id"]] = rel

    ontology_path = graph_dir / "ontology.json"
    entities_path = graph_dir / "entities.jsonl"
    relations_path = graph_dir / "relations.jsonl"
    summary_path = graph_dir / "summary.json"

    ontology_path.write_text(json.dumps(ontology(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_jsonl(entities_path, sorted(entities.values(), key=lambda row: row["id"]))
    write_jsonl(relations_path, sorted(relations_by_id.values(), key=lambda row: row["id"]))
    summary_path.write_text(
        json.dumps(
            {
                "query": args.query,
                "candidateChunks": len(results),
                "entityCount": len(entities),
                "relationCount": len(relations_by_id),
                "outputs": {
                    "ontology": str(ontology_path),
                    "entities": str(entities_path),
                    "relations": str(relations_path),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Candidate chunks: {len(results)}")
    print(f"Entities: {len(entities)}")
    print(f"Relations: {len(relations_by_id)}")
    print(f"Wrote {graph_dir}")


if __name__ == "__main__":
    main()
