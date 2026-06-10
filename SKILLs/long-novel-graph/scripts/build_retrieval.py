#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path


HAN_RE = re.compile(r"[\u4e00-\u9fff]+")
ASCII_RE = re.compile(r"[A-Za-z0-9_]{2,}")


def read_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_jsonl(path: Path, rows):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def cjk_terms(text: str) -> list[str]:
    terms: set[str] = set(token.lower() for token in ASCII_RE.findall(text))
    for span in HAN_RE.findall(text):
        if 2 <= len(span) <= 12:
            terms.add(span)
        # 为中文短查询保留少量 trigram，避免把长篇正文膨胀成过大的索引。
        # 原文仍写入 text 字段，FTS 可命中完整连续短语。
        for size in (3,):
            for index in range(0, max(0, min(len(span), 80) - size + 1)):
                terms.add(span[index : index + size])
    return sorted(terms)


def build_chunks(manifest: dict, chapters: list[dict], chunk_lines: int, overlap_lines: int) -> list[dict]:
    source_path = Path(manifest["sourcePath"])
    lines = source_path.read_text(encoding="utf-8").split("\n")
    slug = manifest.get("slug") or "book"
    chunks: list[dict] = []
    step = max(1, chunk_lines - overlap_lines)

    for chapter in chapters:
        chapter_line_numbers = list(range(chapter["lineStart"], chapter["lineEnd"] + 1))
        content_line_numbers = [
            line_no
            for line_no in chapter_line_numbers
            if lines[line_no - 1].strip()
        ]
        if not content_line_numbers:
            continue

        for start_index in range(0, len(content_line_numbers), step):
            selected = content_line_numbers[start_index : start_index + chunk_lines]
            if not selected:
                continue
            text = "\n".join(lines[line_no - 1].strip() for line_no in selected)
            chunk_id = f"{slug}-chunk-{len(chunks) + 1:06d}"
            chunks.append(
                {
                    "chunkId": chunk_id,
                    "bookSlug": slug,
                    "chapterId": chapter["id"],
                    "volume": chapter.get("volume"),
                    "chapter": chapter["heading"],
                    "lineStart": selected[0],
                    "lineEnd": selected[-1],
                    "charStart": chapter.get("charStart"),
                    "charEnd": chapter.get("charEnd"),
                    "text": text,
                    "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                }
            )
            if start_index + chunk_lines >= len(content_line_numbers):
                break

    return chunks


def build_sqlite(book_dir: Path, chunks: list[dict]):
    db_path = book_dir / "search.sqlite"
    if db_path.exists():
        db_path.unlink()

    connection = sqlite3.connect(db_path)
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE chunk_meta (
              chunk_id TEXT PRIMARY KEY,
              book_slug TEXT NOT NULL,
              chapter_id TEXT NOT NULL,
              volume TEXT,
              chapter TEXT NOT NULL,
              line_start INTEGER NOT NULL,
              line_end INTEGER NOT NULL,
              text_sha256 TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE VIRTUAL TABLE chunk_fts USING fts5(
              chunk_id UNINDEXED,
              book_slug UNINDEXED,
              chapter_id UNINDEXED,
              volume UNINDEXED,
              chapter UNINDEXED,
              line_start UNINDEXED,
              line_end UNINDEXED,
              text,
              search_text,
              tokenize='unicode61'
            )
            """
        )
        for chunk in chunks:
            search_text = " ".join(cjk_terms(chunk["text"]))
            connection.execute(
                """
                INSERT INTO chunk_meta
                (chunk_id, book_slug, chapter_id, volume, chapter, line_start, line_end, text_sha256)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk["chunkId"],
                    chunk["bookSlug"],
                    chunk["chapterId"],
                    chunk.get("volume"),
                    chunk["chapter"],
                    chunk["lineStart"],
                    chunk["lineEnd"],
                    chunk["textSha256"],
                ),
            )
            connection.execute(
                """
                INSERT INTO chunk_fts
                (chunk_id, book_slug, chapter_id, volume, chapter, line_start, line_end, text, search_text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk["chunkId"],
                    chunk["bookSlug"],
                    chunk["chapterId"],
                    chunk.get("volume"),
                    chunk["chapter"],
                    chunk["lineStart"],
                    chunk["lineEnd"],
                    chunk["text"],
                    search_text,
                ),
            )
        connection.execute(
            """
            CREATE TABLE retrieval_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT INTO retrieval_meta (key, value) VALUES (?, ?)",
            ("chunk_count", str(len(chunks))),
        )
        connection.commit()
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="Build chunks.jsonl and SQLite FTS5 retrieval index for a long novel.")
    parser.add_argument("--book", required=True, help="Book output directory containing manifest.json and chapters.jsonl.")
    parser.add_argument("--chunk-lines", type=int, default=24)
    parser.add_argument("--overlap-lines", type=int, default=6)
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    manifest = json.loads((book_dir / "manifest.json").read_text(encoding="utf-8"))
    chapters = list(read_jsonl(book_dir / "chapters.jsonl"))
    chunks = build_chunks(manifest, chapters, args.chunk_lines, args.overlap_lines)

    write_jsonl(book_dir / "chunks.jsonl", chunks)
    build_sqlite(book_dir, chunks)

    print(f"Built {len(chunks)} chunks.")
    print(f"Wrote {book_dir / 'chunks.jsonl'}")
    print(f"Wrote {book_dir / 'search.sqlite'}")


if __name__ == "__main__":
    main()
