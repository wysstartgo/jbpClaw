# 小说图谱 ontology schema

## Entity types

- `Book`: 书籍
- `Volume`: 卷
- `Chapter`: 章节
- `Character`: 人物
- `Location`: 地点
- `Faction`: 门派、家族、势力、国家
- `Artifact`: 法宝、兵器、书籍、重要物品
- `Event`: 事件
- `Concept`: 境界、术语、规则、抽象概念

## Relation types

- `CONTAINS`: Book -> Volume -> Chapter
- `APPEARS_IN`: entity -> Chapter
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
- `RELATED_TO`: weak relation; requires confidence and rationale

## Evidence anchor

Every extracted entity and relation must include:

```json
{
  "bookSlug": "jianlai",
  "chapterId": "jianlai-chapter-0001",
  "lineStart": 14,
  "lineEnd": 64,
  "charStart": 113,
  "charEnd": 3153,
  "source": "extracted|inferred|ambiguous",
  "confidence": 0.0
}
```

Rules:
- `extracted` means the relation is directly supported by text.
- `inferred` means the model inferred it from context; keep a rationale.
- `ambiguous` means the evidence is weak or conflicting.
- Do not create graph edges without evidence anchors.

## Relation temporal fields

Relations may include optional temporal/status fields when the text clearly describes historical state, later transition, or current state.

```json
{
  "temporalQualifier": "current|former|later|transition|historical|ambiguous",
  "status": "former_lineage",
  "statusNote": "崔瀺曾是文圣首徒，但此处只表达历史谱系归属。",
  "validFromChapterId": "jianlai-chapter-0154",
  "validToChapterId": "jianlai-chapter-0713"
}
```

Rules:
- Keep the base relation type stable, such as `LINEAGE_OF` or `BELONGS_TO`; do not create new relation types only to express time.
- Use `former` for clearly historical membership or identity.
- Use `later` for a later state relative to another relation, such as betrayal or opposition after former membership.
- Use `transition` for explicit transfer/change, such as moving from one lineage to another.
- Use `historical` when the text is about past facts but not a clean former/current contrast.
- Use `ambiguous` only when the status wording itself is uncertain; low-confidence facts still belong in review.
- `validFromChapterId` and `validToChapterId` are optional and must reference known chapters when present.
- Never infer exact start/end chapters unless the text directly supports them.
