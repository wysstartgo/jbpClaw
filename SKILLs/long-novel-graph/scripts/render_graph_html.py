#!/usr/bin/env python3
import argparse
import html
import json
import math
from pathlib import Path


TYPE_COLORS = {
    "Chapter": "#64748b",
    "Character": "#2563eb",
    "Location": "#16a34a",
    "Faction": "#9333ea",
    "Artifact": "#d97706",
    "Concept": "#dc2626",
    "Event": "#0891b2",
}

CANVAS_WIDTH = 1600
CANVAS_HEIGHT = 1040

STRONG_RELATION_TYPES = {
    "PARTICIPATES_IN",
    "OCCURS_IN",
    "OWNS_OR_USES",
    "BELONGS_TO",
    "MENTORS",
    "DISCIPLE_OF",
    "FELLOW_DISCIPLE_OF",
    "LINEAGE_OF",
    "OPPOSES",
    "RELATED_TO",
    "PROTECTS",
    "TRAVELS_WITH",
    "TEACHES",
    "TRUSTS",
    "OWES_DEBT_TO",
    "FAMILY_OF",
    "FRIEND_OF",
    "RIVAL_OF",
}

LINEAGE_RELATION_TYPES = {
    "DISCIPLE_OF",
    "FELLOW_DISCIPLE_OF",
    "LINEAGE_OF",
    "MENTORS",
    "OPPOSES",
}

WENSHENG_CORE_IDS = {
    "character:老秀才",
    "character:崔瀺",
    "character:齐静春",
    "character:左右",
    "character:君倩",
    "character:刘十六",
    "character:茅小冬",
    "character:陈平安",
    "character:李宝瓶",
    "character:郑又乾",
    "character:崔东山",
    "character:马瞻",
    "character:吴鸢",
    "character:宋和",
    "faction:文圣一脉",
    "faction:礼圣一脉",
    "faction:山崖书院",
    "faction:大骊王朝",
}


def read_jsonl(path: Path):
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def node_position(index: int, count: int):
    if count <= 1:
        return CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2
    center_x = CANVAS_WIDTH / 2
    center_y = CANVAS_HEIGHT / 2
    bands = [
        (6, 155),
        (18, 330),
        (40, 520),
    ]
    remaining = count
    start = 0
    for capacity, radius in bands:
        band_count = min(capacity, remaining)
        if index < start + band_count:
            band_index = index - start
            angle = (2 * math.pi * band_index) / max(1, band_count)
            angle += (start % 2) * (math.pi / max(2, band_count))
            return center_x + math.cos(angle) * radius, center_y + math.sin(angle) * radius
        start += band_count
        remaining -= band_count

    outer_count = count - start
    band_index = index - start
    ring_offset = band_index // 48
    index_in_ring = band_index % 48
    ring_count = min(48, outer_count - ring_offset * 48)
    radius = 680 + ring_offset * 150
    angle = (2 * math.pi * index_in_ring) / max(1, ring_count)
    angle += (ring_offset % 2) * (math.pi / max(2, ring_count))
    return center_x + math.cos(angle) * radius, center_y + math.sin(angle) * radius


def graph_payload(graph_dir: Path):
    book_dir = graph_dir.parent
    entities = read_jsonl(graph_dir / "entities.jsonl")
    relations = read_jsonl(graph_dir / "relations.jsonl")
    review_relations = read_jsonl(graph_dir / "review-relations.jsonl")
    aliases = read_jsonl(graph_dir / "aliases.jsonl")
    events = read_jsonl(book_dir / "events.jsonl")
    characters = read_jsonl(book_dir / "characters.jsonl")
    summary_path = graph_dir / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}

    degrees = {entity["id"]: 0 for entity in entities}
    for relation in relations:
        degrees[relation["sourceId"]] = degrees.get(relation["sourceId"], 0) + 1
        degrees[relation["targetId"]] = degrees.get(relation["targetId"], 0) + 1

    sorted_entities = sorted(entities, key=lambda item: (-degrees.get(item["id"], 0), item["type"], item["name"]))
    count = max(1, len(sorted_entities))
    nodes = []
    for index, entity in enumerate(sorted_entities):
        node_radius = 8 + min(14, degrees.get(entity["id"], 0) * 1.2)
        x, y = node_position(index, count)
        nodes.append(
            {
                **entity,
                "degree": degrees.get(entity["id"], 0),
                "x": x,
                "y": y,
                "radius": node_radius,
                "color": TYPE_COLORS.get(entity["type"], "#475569"),
            }
        )

    node_ids = {node["id"] for node in nodes}
    edges = [relation for relation in relations if relation["sourceId"] in node_ids and relation["targetId"] in node_ids]
    relation_types = sorted({edge["type"] for edge in edges})
    return {
        "summary": summary,
        "nodes": nodes,
        "edges": edges,
        "reviewRelations": review_relations,
        "aliases": aliases,
        "events": events,
        "characters": characters,
        "colors": TYPE_COLORS,
        "relationTypes": relation_types,
        "lineageRelationTypes": sorted(LINEAGE_RELATION_TYPES),
        "wenshengCoreIds": sorted(WENSHENG_CORE_IDS),
        "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
    }


def render_html(payload: dict):
    data = json.dumps(payload, ensure_ascii=False)
    escaped_data = data.replace("</", "<\\/")
    title = payload.get("summary", {}).get("query") or "Novel Graph"
    return f"""<!doctype html>
<html lang=\"zh-CN\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>Novel Graph - {html.escape(title)}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f8fafc;
      --panel: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --line: #dbe3ef;
      --accent: #2563eb;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;
      background: var(--bg);
      color: var(--text);
    }}
    .shell {{
      display: grid;
      grid-template-columns: minmax(720px, 1fr) 360px;
      min-height: 100vh;
    }}
    .main {{
      padding: 20px;
    }}
    .topbar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }}
    h1 {{
      margin: 0;
      font-size: 20px;
      letter-spacing: 0;
    }}
    .stats {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 13px;
    }}
    .pill {{
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 999px;
      padding: 5px 9px;
    }}
    .graph-wrap {{
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 8px;
      overflow: auto;
      min-height: 780px;
    }}
    svg {{
      width: max(100%, 1600px);
      height: 1040px;
      display: block;
    }}
    .edge {{
      stroke: #94a3b8;
      stroke-opacity: 0.55;
      cursor: pointer;
    }}
    .edge.ambiguous {{
      stroke-dasharray: 5 4;
      stroke-opacity: 0.42;
    }}
    .edge.strong {{
      stroke: #2563eb;
      stroke-opacity: 0.72;
    }}
    .node {{
      cursor: pointer;
      stroke: #fff;
      stroke-width: 2;
    }}
    .node-label {{
      pointer-events: none;
      font-size: 12px;
      fill: #0f172a;
      paint-order: stroke;
      stroke: #fff;
      stroke-width: 4px;
      stroke-linejoin: round;
    }}
    .dim {{ opacity: 0.16; }}
    .selected {{
      stroke: #0f172a;
      stroke-width: 3;
    }}
    .side {{
      border-left: 1px solid var(--line);
      background: var(--panel);
      padding: 18px;
      overflow: auto;
      max-height: 100vh;
    }}
    .search {{
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 14px;
      outline: none;
      margin-bottom: 14px;
    }}
    .section-title {{
      font-size: 12px;
      color: var(--muted);
      margin: 14px 0 8px;
    }}
    .segmented {{
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
      margin-bottom: 14px;
    }}
    .segmented button,
    .filter-chip {{
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 8px;
      padding: 8px 9px;
      font-size: 12px;
      color: #334155;
      cursor: pointer;
      text-align: center;
    }}
    .segmented button.active,
    .filter-chip.active {{
      border-color: var(--accent);
      color: var(--accent);
      background: #eff6ff;
    }}
    .filters {{
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }}
    .legend {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }}
    .legend-item {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }}
    .swatch {{
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }}
    .detail h2 {{
      font-size: 16px;
      margin: 0 0 8px;
    }}
    .detail .meta {{
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 12px;
      line-height: 1.5;
    }}
    .evidence {{
      border-top: 1px solid var(--line);
      padding-top: 12px;
      margin-top: 12px;
    }}
    .evidence-title {{
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }}
    .quote {{
      font-size: 13px;
      line-height: 1.7;
      color: #1e293b;
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      white-space: pre-wrap;
    }}
    .timeline {{
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }}
    .timeline-item {{
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fff;
      cursor: pointer;
    }}
    .timeline-item strong {{
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
    }}
    .timeline-item span {{
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }}
    @media (max-width: 980px) {{
      .shell {{ grid-template-columns: 1fr; }}
      .side {{ border-left: 0; border-top: 1px solid var(--line); max-height: none; }}
      .graph-wrap {{ min-height: 620px; }}
      svg {{ width: 1600px; height: 1040px; }}
    }}
  </style>
</head>
<body>
  <div class=\"shell\">
    <main class=\"main\">
      <div class=\"topbar\">
        <div>
          <h1>证据锚定小说图谱</h1>
          <div class=\"stats\" id=\"stats\"></div>
        </div>
      </div>
      <div class=\"graph-wrap\">
        <svg id=\"graph\" viewBox=\"0 0 1600 1040\" role=\"img\" aria-label=\"小说知识图谱\"></svg>
      </div>
    </main>
    <aside class=\"side\">
      <input class=\"search\" id=\"search\" placeholder=\"搜索节点名称或类型\" />
      <div class=\"section-title\">视图模式</div>
      <div class=\"segmented\" id=\"viewMode\">
        <button data-view=\"all\" class=\"active\">全部</button>
        <button data-view=\"lineage\">谱系</button>
        <button data-view=\"character\">人物</button>
        <button data-view=\"timeline\">事件</button>
        <button data-view=\"review\">待审</button>
      </div>
      <div class=\"section-title\">关系过滤</div>
      <div class=\"filters\" id=\"relationFilters\"></div>
      <div class=\"legend\" id=\"legend\"></div>
      <div class=\"detail\" id=\"detail\"></div>
    </aside>
  </div>
  <script>
    const payload = {escaped_data};
    const svg = document.getElementById('graph');
    const detail = document.getElementById('detail');
    const search = document.getElementById('search');
    const nodeById = new Map(payload.nodes.map((node) => [node.id, node]));
    const characterById = new Map((payload.characters || []).map((item) => [item.characterId, item]));
    const eventById = new Map((payload.events || []).map((item) => [item.eventId, item]));
    const strongTypes = new Set({json.dumps(sorted(STRONG_RELATION_TYPES), ensure_ascii=False)});
    const lineageTypes = new Set(payload.lineageRelationTypes || []);
    const wenshengCoreIds = new Set(payload.wenshengCoreIds || []);
    const activeRelationTypes = new Set((payload.relationTypes || []).filter((type) => type !== 'CO_OCCURS_WITH'));
    let selectedId = null;
    let filterText = '';
    let viewMode = 'all';

    function esc(value) {{
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({{
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }}[char]));
    }}

    function renderStats() {{
      const summary = payload.summary || {{}};
      document.getElementById('stats').innerHTML = [
        `查询：${{esc(summary.query || '未记录')}}`,
        `节点：${{payload.nodes.length}}`,
        `关系：${{payload.edges.length}}`,
        `待审：${{(payload.reviewRelations || []).length}}`,
        `别名：${{(payload.aliases || []).length}}`,
        `候选片段：${{summary.candidateChunks ?? '-'}}`
      ].map((item) => `<span class=\"pill\">${{item}}</span>`).join('');
    }}

    function renderLegend() {{
      document.getElementById('legend').innerHTML = Object.entries(payload.colors)
        .map(([type, color]) => `<span class=\"legend-item\"><span class=\"swatch\" style=\"background:${{color}}\"></span>${{esc(type)}}</span>`)
        .join('');
    }}

    function renderRelationFilters() {{
      const target = document.getElementById('relationFilters');
      target.innerHTML = (payload.relationTypes || []).map((type) => {{
        const active = activeRelationTypes.has(type);
        return `<button class=\"filter-chip ${{active ? 'active' : ''}}\" data-relation=\"${{esc(type)}}\">${{esc(type)}}</button>`;
      }}).join('');
      target.querySelectorAll('[data-relation]').forEach((button) => {{
        button.addEventListener('click', () => {{
          const type = button.getAttribute('data-relation');
          if (activeRelationTypes.has(type)) activeRelationTypes.delete(type);
          else activeRelationTypes.add(type);
          renderRelationFilters();
          renderGraph();
          if (viewMode === 'timeline') renderTimeline();
        }});
      }});
    }}

    function matches(node) {{
      if (!filterText) return true;
      const haystack = `${{node.name}} ${{node.type}} ${{node.id}}`.toLowerCase();
      return haystack.includes(filterText.toLowerCase());
    }}

    function eventMatches(event) {{
      if (!filterText) return true;
      const haystack = [
        event.name,
        event.eventId,
        event.chapterId,
        event.eventType,
        ...(event.participants || []),
        ...(event.locations || []),
        ...(event.artifacts || [])
      ].join(' ').toLowerCase();
      return haystack.includes(filterText.toLowerCase());
    }}

    function nodeIdForName(type, name) {{
      for (const node of payload.nodes) {{
        if (node.type === type && node.name === name) return node.id;
      }}
      return null;
    }}

    function clickableNameList(type, names) {{
      if (!names || !names.length) return '未记录';
      return names.map((name) => {{
        const id = nodeIdForName(type, name);
        if (!id) return esc(name);
        return `<button class=\"filter-chip\" data-jump-node=\"${{esc(id)}}\">${{esc(name)}}</button>`;
      }}).join(' ');
    }}

    function relationRows(items, emptyText) {{
      if (!items || !items.length) return `<div class=\"meta\">${{esc(emptyText)}}</div>`;
      return items.map((item) => {{
        const targetButton = nodeById.has(item.targetId)
          ? `<button class=\"filter-chip\" data-jump-node=\"${{esc(item.targetId)}}\">${{esc(item.targetName || item.targetId)}}</button>`
          : esc(item.targetName || item.targetId);
        const reasons = (item.reviewReasons || []).length ? ` · 待审：${{item.reviewReasons.join(', ')}}` : '';
        const status = [item.temporalQualifier, item.status].filter(Boolean).join(' · ');
        const statusLine = status || item.statusNote
          ? `<br/>状态：${{esc(status || '-')}}${{item.statusNote ? ` · ${{esc(item.statusNote)}}` : ''}}`
          : '';
        return `
          <div class=\"timeline-item\">
            <strong>${{esc(item.type)}} → ${{targetButton}}</strong>
            <span>${{esc(item.chapterId || '')}} · L${{item.lineStart || '-'}}-${{item.lineEnd || '-'}} · confidence ${{item.confidence ?? '-'}}${{esc(reasons)}}${{statusLine}}<br/>${{esc(item.evidenceText || '')}}</span>
          </div>
        `;
      }}).join('');
    }}

    function reviewMatches(relation) {{
      if (!filterText) return true;
      const source = nodeById.get(relation.sourceId);
      const target = nodeById.get(relation.targetId);
      const haystack = [
        relation.id,
        relation.type,
        relation.chapterId,
        relation.evidenceText,
        ...(relation.reviewReasons || []),
        source?.name,
        target?.name
      ].join(' ').toLowerCase();
      return haystack.includes(filterText.toLowerCase());
    }}

    function bindJumpButtons(root = detail) {{
      root.querySelectorAll('[data-jump-node]').forEach((button) => {{
        button.addEventListener('click', () => selectNode(button.getAttribute('data-jump-node')));
      }});
    }}

    function edgeAllowed(edge) {{
      if (!activeRelationTypes.has(edge.type)) return false;
      if (viewMode === 'lineage') {{
        return lineageTypes.has(edge.type) && (wenshengCoreIds.has(edge.sourceId) || wenshengCoreIds.has(edge.targetId));
      }}
      if (viewMode === 'character') {{
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) return false;
        const types = new Set([source.type, target.type]);
        return types.has('Character') && edge.type !== 'APPEARS_IN' && edge.type !== 'CO_OCCURS_WITH';
      }}
      if (viewMode === 'timeline') {{
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        return source?.type === 'Event' || target?.type === 'Event';
      }}
      if (viewMode === 'review') return false;
      return true;
    }}

    function connectedToSelected(id) {{
      if (!selectedId) return true;
      if (id === selectedId) return true;
      return payload.edges.some((edge) =>
        edgeAllowed(edge) && (
          (edge.sourceId === selectedId && edge.targetId === id) ||
          (edge.targetId === selectedId && edge.sourceId === id)
        )
      );
    }}

    function renderGraph() {{
      const allowedEdges = payload.edges.filter(edgeAllowed);
      const edgeNodeIds = new Set();
      allowedEdges.forEach((edge) => {{
        edgeNodeIds.add(edge.sourceId);
        edgeNodeIds.add(edge.targetId);
      }});
      const visibleNodes = new Set(payload.nodes.filter((node) => {{
        if (!matches(node)) return false;
        if (viewMode === 'all') return true;
        return edgeNodeIds.has(node.id);
      }}).map((node) => node.id));
      const edgeMarkup = payload.edges.map((edge) => {{
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) return '';
        const visible = edgeAllowed(edge) && visibleNodes.has(source.id) && visibleNodes.has(target.id);
        const connected = selectedId ? (edge.sourceId === selectedId || edge.targetId === selectedId) : true;
        const strong = strongTypes.has(edge.type);
        const cls = ['edge', edge.source === 'ambiguous' ? 'ambiguous' : '', strong ? 'strong' : '', visible && connected ? '' : 'dim'].join(' ');
        return `<line class=\"${{cls}}\" x1=\"${{source.x}}\" y1=\"${{source.y}}\" x2=\"${{target.x}}\" y2=\"${{target.y}}\" stroke-width=\"${{Math.max(1, edge.confidence * 4)}}\" data-edge=\"${{esc(edge.id)}}\" />`;
      }}).join('');

      const nodeMarkup = payload.nodes.map((node) => {{
        const visible = visibleNodes.has(node.id) && connectedToSelected(node.id);
        const cls = ['node', node.id === selectedId ? 'selected' : '', visible ? '' : 'dim'].join(' ');
        const labelY = node.y + node.radius + 15;
        return `
          <circle class=\"${{cls}}\" cx=\"${{node.x}}\" cy=\"${{node.y}}\" r=\"${{node.radius}}\" fill=\"${{node.color}}\" data-node=\"${{esc(node.id)}}\" />
          <text class=\"node-label ${{visible ? '' : 'dim'}}\" x=\"${{node.x}}\" y=\"${{labelY}}\" text-anchor=\"middle\">${{esc(node.name)}}</text>
        `;
      }}).join('');

      svg.innerHTML = `<g>${{edgeMarkup}}</g><g>${{nodeMarkup}}</g>`;
      svg.querySelectorAll('[data-node]').forEach((el) => {{
        el.addEventListener('click', () => selectNode(el.getAttribute('data-node')));
      }});
      svg.querySelectorAll('[data-edge]').forEach((el) => {{
        el.addEventListener('click', () => selectEdge(el.getAttribute('data-edge')));
      }});
    }}

    function renderTimeline() {{
      const assetEvents = (payload.events || [])
        .filter(eventMatches)
        .sort((a, b) => (a.lineStart || 0) - (b.lineStart || 0));
      const nodeEvents = payload.nodes
        .filter((node) => node.type === 'Event' && matches(node))
        .map((node) => {{
          const evidence = (node.evidence || [])[0] || {{}};
          return {{
            eventId: node.id,
            name: node.name,
            chapterId: evidence.chapterId,
            lineStart: evidence.lineStart,
            lineEnd: evidence.lineEnd,
            participants: [],
            locations: [],
            artifacts: [],
            eventType: 'node',
            evidenceText: evidence.evidenceText || ''
          }};
        }})
        .sort((a, b) => (a.lineStart || 0) - (b.lineStart || 0));
      const sourceEvents = assetEvents.length ? assetEvents : nodeEvents;
      const items = sourceEvents.map((event) => {{
        const node = nodeById.get(event.eventId);
        const connected = node ? payload.edges
          .filter((edge) => edgeAllowed(edge) && (edge.sourceId === node.id || edge.targetId === node.id))
          .map((edge) => {{
            const otherId = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
            const other = nodeById.get(otherId);
            return `${{edge.type}}: ${{other?.name || otherId}}`;
          }})
          .slice(0, 4)
          .join('；') : '';
        const chips = [
          (event.participants || []).length ? `参与：${{event.participants.join('、')}}` : '',
          (event.locations || []).length ? `地点：${{event.locations.join('、')}}` : '',
          (event.artifacts || []).length ? `物品：${{event.artifacts.join('、')}}` : '',
          connected
        ].filter(Boolean).join('；');
        return `
          <div class=\"timeline-item\" data-event=\"${{esc(event.eventId)}}\">
            <strong>${{esc(event.name)}}</strong>
            <span>${{esc(event.chapterId || '')}} · L${{event.lineStart || '-'}}-${{event.lineEnd || '-'}} · ${{esc(event.eventType || 'event')}}<br/>${{esc(chips || '暂无强关系')}}</span>
          </div>
        `;
      }}).join('');
      detail.innerHTML = `
        <h2>事件时间线</h2>
        <div class=\"meta\">优先读取 events.jsonl；按证据行号排序，并显示参与者、地点和证据锚点。</div>
        <div class=\"timeline\">${{items || '<div class=\"meta\">当前过滤条件下没有事件。</div>'}}</div>
      `;
      detail.querySelectorAll('[data-event]').forEach((el) => {{
        el.addEventListener('click', () => {{
          const eventId = el.getAttribute('data-event');
          if (eventById.has(eventId)) selectEventAsset(eventId);
          else if (nodeById.has(eventId)) selectNode(eventId);
        }});
      }});
    }}

    function renderReviewPanel() {{
      const rows = (payload.reviewRelations || [])
        .filter(reviewMatches)
        .map((relation) => {{
          const source = nodeById.get(relation.sourceId);
          const target = nodeById.get(relation.targetId);
          const sourceLabel = source
            ? `<button class=\"filter-chip\" data-jump-node=\"${{esc(source.id)}}\">${{esc(source.name)}}</button>`
            : esc(relation.sourceId);
          const targetLabel = target
            ? `<button class=\"filter-chip\" data-jump-node=\"${{esc(target.id)}}\">${{esc(target.name)}}</button>`
            : esc(relation.targetId);
          return `
            <div class=\"timeline-item\">
              <strong>${{esc(relation.type)}} · ${{esc(relation.id)}}</strong>
              <span>${{sourceLabel}} → ${{targetLabel}}<br/>${{esc(relation.chapterId || '')}} · L${{relation.lineStart || '-'}}-${{relation.lineEnd || '-'}} · confidence ${{relation.confidence ?? '-'}}<br/>原因：${{esc((relation.reviewReasons || []).join(', ') || '未记录')}}<br/>${{esc(relation.evidenceText || '')}}</span>
            </div>
          `;
        }})
        .join('');
      detail.innerHTML = `
        <h2>待审关系</h2>
        <div class=\"meta\">这些关系尚未进入主图谱，需要人工确认后通过 promote_review_relation.py 提升。</div>
        <div class=\"timeline\">${{rows || '<div class=\"meta\">当前没有待审关系。</div>'}}</div>
      `;
      bindJumpButtons();
    }}

    function renderLineagePanel() {{
      const rows = payload.edges
        .filter((edge) => lineageTypes.has(edge.type) && (wenshengCoreIds.has(edge.sourceId) || wenshengCoreIds.has(edge.targetId)))
        .filter((edge) => {{
          if (!filterText) return true;
          const source = nodeById.get(edge.sourceId);
          const target = nodeById.get(edge.targetId);
          const haystack = [edge.type, edge.chapterId, edge.evidenceText, edge.temporalQualifier, edge.status, edge.statusNote, source?.name, target?.name].join(' ').toLowerCase();
          return haystack.includes(filterText.toLowerCase());
        }})
        .sort((a, b) => {{
          const sourceA = nodeById.get(a.sourceId)?.name || a.sourceId;
          const sourceB = nodeById.get(b.sourceId)?.name || b.sourceId;
          return sourceA.localeCompare(sourceB, 'zh-CN') || a.type.localeCompare(b.type);
        }})
        .map((edge) => {{
          const source = nodeById.get(edge.sourceId);
          const target = nodeById.get(edge.targetId);
          const sourceLabel = source
            ? `<button class=\"filter-chip\" data-jump-node=\"${{esc(source.id)}}\">${{esc(source.name)}}</button>`
            : esc(edge.sourceId);
          const targetLabel = target
            ? `<button class=\"filter-chip\" data-jump-node=\"${{esc(target.id)}}\">${{esc(target.name)}}</button>`
            : esc(edge.targetId);
          const status = [edge.temporalQualifier, edge.status].filter(Boolean).join(' · ');
          const statusLine = status || edge.statusNote
            ? `<br/>状态：${{esc(status || '-')}}${{edge.statusNote ? ` · ${{esc(edge.statusNote)}}` : ''}}`
            : '';
          return `
            <div class=\"timeline-item\" data-lineage-edge=\"${{esc(edge.id)}}\">
              <strong>${{sourceLabel}} → ${{targetLabel}}</strong>
              <span>${{esc(edge.type)}} · ${{esc(edge.chapterId || '')}} · L${{edge.lineStart || '-'}}-${{edge.lineEnd || '-'}} · confidence ${{edge.confidence ?? '-'}}${{statusLine}}<br/>${{esc(edge.evidenceText || '')}}</span>
            </div>
          `;
        }})
        .join('');
      detail.innerHTML = `
        <h2>文圣一脉谱系</h2>
        <div class=\"meta\">显示文圣一脉核心节点相关的师承、同门、谱系、引导与叛出关系。待审关系仍在“待审”视图中单独查看。</div>
        <div class=\"timeline\">${{rows || '<div class=\"meta\">当前过滤条件下没有谱系关系。</div>'}}</div>
      `;
      bindJumpButtons();
      detail.querySelectorAll('[data-lineage-edge]').forEach((el) => {{
        el.addEventListener('click', () => selectEdge(el.getAttribute('data-lineage-edge')));
      }});
    }}

    function selectEventAsset(id) {{
      const event = eventById.get(id);
      if (!event) return;
      selectedId = null;
      const participants = clickableNameList('Character', event.participants || []);
      const locations = clickableNameList('Location', event.locations || []);
      const artifacts = (event.artifacts || []).join('、') || '未记录';
      detail.innerHTML = `
        <h2>${{esc(event.name)}}</h2>
        <div class=\"meta\">
          类型：${{esc(event.eventType || 'event')}}<br/>
          ID：${{esc(event.eventId)}}<br/>
          ${{esc(event.chapterId || '')}} · L${{event.lineStart || '-'}}-${{event.lineEnd || '-'}}<br/>
          参与者：${{participants}}<br/>
          地点：${{locations}}<br/>
          物品：${{esc(artifacts)}}<br/>
          来源：${{esc(event.source || '')}} · confidence ${{event.confidence ?? '-'}}
        </div>
        ${{event.evidenceText ? `<div class=\"evidence\"><div class=\"evidence-title\">证据片段</div><div class=\"quote\">${{esc(event.evidenceText)}}</div></div>` : '<div class=\"meta\">暂无证据片段</div>'}}
      `;
      bindJumpButtons();
      renderGraph();
    }}

    function selectNode(id) {{
      selectedId = selectedId === id ? null : id;
      const node = nodeById.get(id);
      if (!node) return;
      const profile = characterById.get(id);
      const profileBlock = profile ? `
        <div class=\"evidence\">
          <div class=\"evidence-title\">人物卡片</div>
          <div class=\"meta\">首次出现：${{esc(profile.firstSeen?.chapterId || '')}} · L${{profile.firstSeen?.lineStart || '-'}}-${{profile.firstSeen?.lineEnd || '-'}}</div>
          ${{(profile.aliases || []).length ? `<div class=\"meta\">别名：${{profile.aliases.map((item) => `${{esc(item.aliasName)}}（L${{item.lineStart || '-'}}-${{item.lineEnd || '-'}}）`).join('、')}}</div>` : ''}}
          ${{profile.description ? `<div class=\"quote\">${{esc(profile.description)}}</div>` : ''}}
          <div class=\"meta\">强关系：${{(profile.strongRelations || []).length}} · 出现章节：${{(profile.appearances || []).length}} · 待审：${{(profile.reviewCandidates || []).length}}</div>
          <div class=\"evidence-title\">强关系</div>
          <div class=\"timeline\">${{relationRows(profile.strongRelations || [], '暂无强关系')}}</div>
          <div class=\"evidence-title\">出现章节</div>
          <div class=\"timeline\">${{relationRows(profile.appearances || [], '暂无出现章节')}}</div>
          <div class=\"evidence-title\">待审候选</div>
          <div class=\"timeline\">${{relationRows(profile.reviewCandidates || [], '暂无待审候选')}}</div>
        </div>
      ` : '';
      const evidence = (node.evidence || []).map((item) => `
        <div class=\"evidence\">
          <div class=\"evidence-title\">${{esc(item.chapterId)}} · L${{item.lineStart}}-${{item.lineEnd}} · ${{esc(item.source)}} · confidence ${{item.confidence}}</div>
          ${{item.evidenceText ? `<div class=\"quote\">${{esc(item.evidenceText)}}</div>` : ''}}
        </div>
      `).join('');
      detail.innerHTML = `
        <h2>${{esc(node.name)}}</h2>
        <div class=\"meta\">类型：${{esc(node.type)}}<br/>ID：${{esc(node.id)}}<br/>度数：${{node.degree}}</div>
        ${{profileBlock}}
        ${{evidence || '<div class=\"meta\">暂无证据锚点</div>'}}
      `;
      bindJumpButtons();
      renderGraph();
    }}

    function selectEdge(id) {{
      const edge = payload.edges.find((item) => item.id === id);
      if (!edge) return;
      selectedId = null;
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      const status = [edge.temporalQualifier, edge.status].filter(Boolean).join(' · ');
      const statusBlock = status || edge.statusNote || edge.validFromChapterId || edge.validToChapterId
        ? `<div class=\"meta\">状态：${{esc(status || '-')}}${{edge.statusNote ? `<br/>说明：${{esc(edge.statusNote)}}` : ''}}${{edge.validFromChapterId || edge.validToChapterId ? `<br/>有效章节：${{esc(edge.validFromChapterId || '-')}} → ${{esc(edge.validToChapterId || '-')}}` : ''}}</div>`
        : '';
      detail.innerHTML = `
        <h2>${{esc(edge.type)}}</h2>
        <div class=\"meta\">
          ${{esc(source?.name || edge.sourceId)}} → ${{esc(target?.name || edge.targetId)}}<br/>
          来源：${{esc(edge.source)}} · confidence ${{edge.confidence}}<br/>
          ${{esc(edge.chapterId)}} · L${{edge.lineStart}}-${{edge.lineEnd}}
        </div>
        ${{statusBlock}}
        ${{edge.rationale ? `<div class=\"quote\">${{esc(edge.rationale)}}</div>` : ''}}
        <div class=\"evidence\">
          <div class=\"evidence-title\">证据片段</div>
          <div class=\"quote\">${{esc(edge.evidenceText || '')}}</div>
        </div>
      `;
      renderGraph();
    }}

    search.addEventListener('input', () => {{
      filterText = search.value.trim();
      selectedId = null;
      renderGraph();
      if (viewMode === 'lineage') renderLineagePanel();
      if (viewMode === 'timeline') renderTimeline();
      if (viewMode === 'review') renderReviewPanel();
    }});

    document.getElementById('viewMode').querySelectorAll('[data-view]').forEach((button) => {{
      button.addEventListener('click', () => {{
        viewMode = button.getAttribute('data-view');
        document.getElementById('viewMode').querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', item === button));
        selectedId = null;
        if (viewMode === 'lineage') {{
          activeRelationTypes.clear();
          lineageTypes.forEach((type) => {{
            if ((payload.relationTypes || []).includes(type)) activeRelationTypes.add(type);
          }});
          renderRelationFilters();
        }}
        renderGraph();
        if (viewMode === 'lineage') renderLineagePanel();
        else if (viewMode === 'timeline') renderTimeline();
        else if (viewMode === 'review') renderReviewPanel();
        else detail.innerHTML = '<h2>选择节点或关系</h2><div class=\"meta\">点击图中的节点查看证据锚点，点击边查看关系证据。</div>';
      }});
    }});

    renderStats();
    renderLegend();
    renderRelationFilters();
    renderGraph();
    detail.innerHTML = '<h2>选择节点或关系</h2><div class=\"meta\">点击图中的节点查看证据锚点，点击边查看关系证据。</div>';
  </script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description="Render an evidence-anchored novel graph as static HTML.")
    parser.add_argument("--book", required=True)
    parser.add_argument("--out", help="Optional output HTML path. Defaults to <book>/graph/graph.html.")
    args = parser.parse_args()

    book_dir = Path(args.book).resolve()
    graph_dir = book_dir / "graph"
    payload = graph_payload(graph_dir)
    out_path = Path(args.out).resolve() if args.out else graph_dir / "graph.html"
    out_path.write_text(render_html(payload), encoding="utf-8")
    print(f"Rendered {len(payload['nodes'])} nodes and {len(payload['edges'])} edges.")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
