---
name: oceanengine-site-and-landing-assets
description: 适用于 OceanEngine 中与“站点、落地页与模板”相关的需求，优先使用本域 Tool-Range 白名单处理任务，而不是直接暴露全量 AD MCP 工具。
---

# 站点、落地页与模板

## 适用范围

覆盖橙子建站、第三方站点、落地页组、模板与站点预览。

当前域工具数：`24`

典型场景：
- 创建站点、落地页组与模板
- 查询、复制、预览、更新站点资产
- 管理第三方站点与落地页流量分配

示例任务：
- 帮我查询现有站点、模板和落地页组，并做结构概览。
- 帮我判断这个站点是该复制、更新还是新建模板。
- 帮我梳理第三方站点和落地页组的流量分配关系。

非目标：
- 不负责评论运营、线索后链路与素材审核
- 不负责广告项目级预算与出价管理

核心工作流：
- 站点资产盘点：盘点站点、模板和落地页组的整体结构。
- 站点复用与调整：决定当前诉求该复制站点、建模板还是直接更新。

交接边界：
- 若站点需要与广告结构绑定，应交接到“项目、广告与投放搭建”。
- 若站点里涉及表单和线索承接，应交接到“线索、转化与承接链路”。

## 工作流

1. 先确认主体、广告主账户、当前域和用户目标；多主体场景必须按“主体 -> 广告主账户 -> 域 -> 工具”路由。
2. 优先读取 `references/tool-range.json`，只在该白名单内选工具。
3. 先读取 `references/read-tools.json`，优先用只读工具做上下文发现。
4. 若必须改动，再从 `references/write-tools.json` 中选精确工具。
5. 若命中 `references/risky-tools.json`，先回显主体、账户、影响范围和回滚预案，再取得用户确认。
6. 如请求跨域，先完成本域部分，再明确建议切到相邻域 skill。
7. 输出时说明：当前主体、调用工具、结果摘要、风险判断、后续建议。

## 多主体与接入方式

- 单主体首接：优先使用 `references/mcp-config-example.json`，只启用本域或首批只读域。
- 多主体管理：以 `docs/oceanengine/subjects.manifest.example.json` 为主体注册表样例，用 `scripts/oceanengine/build_subject_configs.py` 生成分主体 MCP 配置。
- 可视化配置：在前端“主体管理”页维护主体、启用域、配置预览、导入导出和验收记录；对应实现见 `web/src/components/SubjectManagerPage.tsx`。
- 域推荐：用户目标不清晰时，先用 `scripts/oceanengine/recommend_domain.py` 辅助判断最匹配的分域 skill。
- 接入细节：联机前读取 `docs/oceanengine/2026-04-20-detailed-integration-playbook.md`；多主体治理读取 `docs/oceanengine/2026-04-20-multi-subject-operating-model.md`。

## 验收标准

- 离线资产校验通过：`python3 scripts/oceanengine/validate_domain_assets.py --repo-root .`。
- Tool-Range 生效：MCP 配置只暴露本域 `references/tool-range.json` 中的工具。
- Smoke 验证通过：按 `references/smoke-prompts.md` 跑最小联机问题，并能正确区分只读、写入和高风险工具。
- 验收记录可追溯：在主体管理页记录每个主体、每个域的 `untested` / `passed` / `failed` 状态和备注。
- 输出可审计：每次执行都能说明主体、账户、工具、动作类型、结果摘要和后续建议。

## 工具选择原则

- 域内优先：仅使用本域白名单工具，避免跨域误调。
- 先读后写：先查当前状态，再给出修改动作。
- 小批量优先：支持批量时，先建议从最小必要范围开始。
- 对路径敏感：优先依据 `references/tools.md` 中的 path 与说明选择精确工具。
- 操作分层：结合 `references/operation-groups.md` 理解本域内部子能力块。
- 主体隔离：多主体下默认查询可横向对比，写操作必须单主体串行确认。

## 工程原则落点

- `KISS`：首接先跑单主体、单域、只读流程，避免一次接入过多变量。
- `YAGNI`：不为每个主体复制 skill，主体差异放在 manifest 和 MCP 配置层。
- `SOLID`：skill 只负责本域工作流，主体治理、配置生成、验收记录分别由独立脚本和页面承担。
- `DRY`：Tool-Range、主体注册表和验收记录各有唯一来源，避免在对话或配置中重复维护。

## 需要加载的引用

- `references/domain.json`：本域元数据与验收摘要
- `references/tool-range.json`：供 MCP header 使用的白名单
- `references/read-tools.json`：本域只读工具
- `references/write-tools.json`：本域写操作工具
- `references/risky-tools.json`：需要先确认的高风险工具
- `references/task-templates.md`：本域常见任务模板
- `references/operation-groups.md`：本域内部操作分组
- `references/workflows.md`：本域标准工作流蓝图
- `references/handoffs.md`：本域与相邻域的交接边界
- `references/safety-rules.md`：本域安全规则与执行约束
- `references/operator-checklist.md`：进入执行前的核对清单
- `references/mcp-config-example.json`：本域专用 MCP 配置片段
- `references/smoke-prompts.md`：本域联机最小验证提问集
- `references/tools.md`：本域完整工具清单与 path 对照
- `docs/oceanengine/2026-04-20-detailed-integration-playbook.md`：仓库级详细接入流程
- `docs/oceanengine/2026-04-20-multi-subject-operating-model.md`：仓库级多主体治理模型
