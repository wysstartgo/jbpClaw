---
name: novel-comic-wechat-post
description: Use when turning long-novel chapters, character arcs, or evidence-anchored excerpts into comic-style WeChat public-account posts with cover strategy, storyboard, comic image prompts/pages, Markdown article, and optional xiaohu-wechat-format publishing.
---

# Novel Comic WeChat Post

Use this skill when the user wants to create a公众号图文推文 from novel content: select chapters, write a spoiler-aware comic article, generate comic panels or page prompts, create a high-click WeChat cover, and format the result for微信公众号.

## Core Rule

Always plan before media generation or publishing. First write or update a方案 section that states:

- source book workspace and book title
- selected chapter IDs or character/faction/story arc filter
- narration mode: `summary` / `excerpt` / `commentary`
- comic style and aspect ratio
- cover backend: `explosive-cover-generator-gzh` / `qingshu-image` / manual prompt
- article output directory
- whether to only draft, generate images, format HTML, or publish draft
- validation command and review checkpoints

Do not generate cover images, comic pages, or publish a WeChat draft until the chapter plan, storyboard, and article draft are reviewable.

## Dependencies

- `novel-comic-wechat-post`: orchestrates chapter selection, storyboard, comic article, cover prompt, image prompt, formatting, and publishing checkpoints.
- `xiaohu-wechat-format`: installed WeChat formatting and draft publishing pipeline. Reuse the already installed JBPClaw runtime skill; do not install another xiaohu copy.
- `explosive-cover-generator-gzh`: installed cover planning skill for data-informed公众号爆款封面 analysis and cover scheme generation.
- `qingshu-image`: JBPClaw 内置专用绘图 Skill. Use it for cover and comic image generation instead of `$codex-image`, OpenAI direct image calls, or API-key based image tools.
- Optional source/storyboard helpers may be used only when present in the current runtime. If `long-novel-graph`, `baoyu-comic`, or `xiaohu-wechat-cover` are not installed, keep their work as structured article planning inside this skill and route actual image generation to `qingshu-image`.

## Output Contract

Each project should live under an independent directory:

```text
comic-wechat/{topic-slug}/
├── source/
│   ├── chapter-plan.json
│   ├── excerpts.md
│   └── evidence.json
├── analysis.md
├── storyboards/
│   ├── storyboard-chronological.md
│   ├── storyboard-thematic.md
│   └── storyboard-character.md
├── storyboard.md
├── characters/
│   ├── characters.md
│   └── characters.png
├── prompts/
│   ├── cover.md
│   └── NN-panel-or-page.md
├── images/
│   ├── cover.jpg
│   └── NN-panel-or-page.png
├── article.md
├── article-formatted/
│   └── index.html
└── publish-report.json
```

## Workflow

1. **Plan and Locate**
   - Use `long-novel-graph` to select chapters by explicit IDs, chapter range, characters, faction, event, or graph relation evidence.
   - Save `source/chapter-plan.json` with `chapterId`, `heading`, `lineStart`, `lineEnd`, `selectionReason`, and `relationEvidence`.
   - Save `source/excerpts.md` with short source excerpts or paraphrase notes.
   - Save `source/evidence.json`; every claim must trace to `chapterId + lineStart + lineEnd`.

2. **Article Angle**
   - Define the公众号 angle before writing: `剧情名场面`, `人物关系`, `命运转折`, `世界观解释`, or `系列连载`.
   - For novel content, prefer a strong opening hook, then a spoiler warning if needed, then comic pages, then interpretation and evidence notes.
   - Do not paste long copyrighted source passages. Use short compliant excerpts and mostly paraphrase or commentary.

3. **Comic Planning**
   - Follow `baoyu-comic` structure for `analysis.md`, three storyboard variants, final `storyboard.md`, and `characters/`.
   - Novel default style:
     - 仙侠/武侠/古风：`wuxia` + `cinematic` or `splash`
     - 人物关系/师门群像：`classic` or `warm` + `mixed`
     - 名场面战斗：`dramatic` + `splash`
   - Comic pages for公众号 should normally be `3:4` or vertical `9:16`; cover remains `2.35:1`.
   - Keep character appearance consistent; use `characters.md` and `characters.png` as reference when supported.

4. **Cover Strategy**
   - Use `explosive-cover-generator-gzh` when the user wants high-click/爆款封面, title hooks, or market-style cover options.
   - Use `qingshu-image` when a cover image must actually be generated inside JBPClaw; treat `explosive-cover-generator-gzh` output as the cover strategy and prompt source.
   - Cover prompt must include:
     - article hook in 8 Chinese characters or fewer when text is needed
     - core character or scene
     - 2.35:1 WeChat cover composition
     - high contrast and clear mobile preview
   - If using `explosive-cover-generator-gzh`, follow its rule: use its data interface, do not replace it with web search.
   - Do not call `xiaohu-wechat-cover` unless that skill is explicitly installed in the current runtime. In the JBPClaw built-in kit, cover generation is `explosive-cover-generator-gzh` + `qingshu-image`.

5. **Generate Images**
   - Generate cover and comic page images only after storyboard and prompts are reviewed.
   - Write every final prompt to `prompts/`.
   - Save generated assets under `images/`.
   - In JBPClaw, use `qingshu-image` as the image backend. If it supports reference images for the current runtime, reuse character/reference assets to keep comic pages visually consistent.

6. **Write WeChat Article**
   - Create `article.md` with:
     - title and optional subtitle
     - cover image reference
     - opening hook
     - spoiler note if needed
     - comic page blocks with captions
     - short evidence notes or chapter references
     - closing question / follow prompt
   - Keep display excerpts short. Do not output full chapters or long source text.
   - Suggested block format:

```markdown
# 标题

![封面](/abs/path/images/cover.jpg)

> 剧透提示：本文涉及第 XXX 章到第 XXX 章。

## 1. 小标题

![漫画页](/abs/path/images/01-page.png)

这段讲的是……

*原文锚点：第 XXX 章，L123-L145*
```

7. **Format and Publish**
   - For formatting, call `xiaohu-wechat-format/scripts/format.py` with a compatible theme such as `newspaper`, `magazine`, `chinese`, or `wechat-native`.
   - Only publish through `xiaohu-wechat-format/scripts/publish.py` when the user explicitly requests draft publishing and credentials are configured.
   - After formatting, verify images are copied into the formatted output image directory.

## Copyright and Evidence Policy

- The article should be a derived commentary/comic adaptation, not a chapter dump.
- Use short excerpts only where necessary; otherwise paraphrase.
- Preserve evidence anchors in `source/evidence.json` and visible chapter references.
- Do not mutate the source book index, graph relations, or original excerpts.
- If the user asks for “全部原文”, refuse full reproduction and provide location plus summary.

## Coordination With Existing Skills

- Read `explosive-cover-generator-gzh/SKILL.md` when doing 爆款封面 analysis.
- Read `qingshu-image/SKILL.md` before generating cover or comic images.
- Read `xiaohu-wechat-format/SKILL.md` before formatting or publishing.
- If `long-novel-graph` or `baoyu-comic` are unavailable, keep chapter evidence and storyboard output in this skill's `source/`, `storyboards/`, `characters/`, and `prompts/` files.

## Completion Report

Report:

- project directory
- selected chapters and evidence count
- article title
- comic style and page count
- cover path
- article Markdown path
- formatted HTML path if generated
- draft `media_id` if published
- remaining review steps
