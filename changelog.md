# QingShuClaw Branch Changelog

## 0. Change Log 维护约定

从 2026-05-20 起，本文件作为当前分支的统一 change log 入口。后续每次发生以下任一情况，都需要在本文件顶部追加一条对应更新记录：

- 修复用户可感知的问题。
- 合入 `origin/main` 的公共能力或 bugfix。
- 调整青数品牌、工作台、内置治理链、唤醒/TTS、IM、多实例、OpenClaw runtime 等关键链路。
- 新增或更新机制文档、FAQ、验收文档。
- 打包测试前有影响行为的代码变更。

每条记录建议包含：

- `更新时间`
- `变更背景`
- `改动内容`
- `影响范围`
- `验证结果`
- `后续注意事项`

原则：

- `KISS`：每次只记录当前批次的真实变化，不写泛泛计划。
- `YAGNI`：不为尚未实现的功能提前记为完成。
- `SOLID`：按模块边界说明影响范围，避免把 UI、runtime、配置投影混在一起。
- `DRY`：已有机制文档只做链接引用，不在 changelog 里重复长篇展开。

## 2026-05-25 OpenClaw runtime 主干专项第 1 轮：差异扫描与保护矩阵

### 变更背景

Subagent 与 `ConversationTurnsView` 小高耦合批次已完成当前可验收收口。下一步需要评估 `origin/main` 的 OpenClaw runtime 主干更新，但该区域同时牵动青数 managed tools、IM 多实例路由、认证 bridge、任务运行中延后重启和 `main.ts/preload.ts`，不能直接整包替换。

### 扫描结论

本轮只做差异扫描和保护矩阵，不改运行时代码。

- `origin/main` 在 [openclawRuntimeAdapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/agentEngine/openclawRuntimeAdapter.ts)、[openclawConfigSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigSync.ts)、[openclawEngineManager.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawEngineManager.ts)、[main.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/main.ts)、[preload.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/preload.ts) 上存在大规模重构。
- `origin/main` 删除了 [catalogService.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/qingshuManaged/catalogService.ts) 和 [managedMcpServer.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/qingshuManaged/managedMcpServer.ts)，当前分支不能接受该删除，因为这会直接破坏青数内置治理链和 managed tool 本地桥接。
- `origin/main` 对 [src/main/im](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/im) 做了大量改写和删除，当前分支已有飞书群聊 Agent 归属、多实例 allowlist、主 Agent 调度边界等业务修复，不能在 OpenClaw runtime 批次里顺手替换。
- `origin/main` 删除了 `openclawTranscript` 相关旧链路，但当前分支仍需确认历史会话恢复、长历史展示、子任务消息、青数 managed session 同步是否完全脱离该路径。

### 保护矩阵

禁止直接整包替换：

- [src/main/qingshuManaged](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/qingshuManaged)
- [src/main/im](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/im)
- [main.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/main.ts)
- [preload.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/preload.ts)
- [openclawRuntimeAdapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/agentEngine/openclawRuntimeAdapter.ts)

灰区小步筛入：

- [openclawConfigSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigSync.ts) 中的浏览器、WebFetch、Dreaming 配置合法性修复。
- [openclawConfigImpact.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigImpact.ts) 中的配置影响分类，但必须保留当前分支的 `openClawSessionPolicy` 和延后重启策略。
- [openclawEngineManager.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawEngineManager.ts) 中的启动稳定性修复，但不得绕开当前分支的任务运行中延后重启。

### 下一轮低风险候选

优先候选：

- `94cb3f4d fix: fix browswer config invalid`
- `fbb8e5f5 fix: fix browser and webfetch failed`
- `b2b90fbe fix(browser): prevent duplicate launches and normalize hostname entries`
- `bd5a079a fix: remove unsupported dreaming config properties causing gateway crash`
- `1742df3e fix: fix model switch error when custom models`

暂缓候选：

- OpenClaw runtime 主干整体重构。
- `main.ts/preload.ts` 大规模替换。
- IM Store / Gateway Manager 大迁移。
- qingshuManaged catalog / MCP server 删除式重构。

### 验证结果

本轮为文档化扫描，后续执行了基础验证：

- `git diff --check`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`

本轮原则应用：

- `KISS`：先把高风险主干拆成红线、灰区、低风险候选，不直接大合并。
- `YAGNI`：不迁入当前还没完成验收路径的 OpenClaw 主干重构。
- `SOLID`：把 managed、IM、runtime lifecycle、config projection 按职责拆开评估。
- `DRY`：保护矩阵同步写入 [青数覆盖层-总索引.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/青数覆盖层-总索引.md)，后续批次复用同一边界。

## 2026-05-25 ConversationTurnsView 迁移专项第 3 轮：最小组件抽取收口

### 变更背景

第 2 轮已完成对话 turn 数据层等价保护。本轮按规划评估是否可以做最小组件抽取，在不影响主会话长历史、TTS、Artifacts、rail 的前提下，缩小当前分支与 `origin/main` 的 `ConversationTurnsView` 结构差距。

### 改动内容

- 新增轻量 [ConversationTurnsView.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/cowork/ConversationTurnsView.tsx)，只封装当前分支已有的 `buildDisplayItems`、`buildConversationTurns`、`UserMessageItem`、`AssistantTurnBlock` 渲染循环。
- [SubagentSessionDetail.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/cowork/SubagentSessionDetail.tsx) 改为使用该轻量组件，减少子任务详情里的重复渲染逻辑。
- 主会话 [CoworkSessionDetail.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/cowork/CoworkSessionDetail.tsx) 暂不替换，继续保留当前分支的 TTS、Artifacts、本地文件打开、消息重编辑、fork、rail、长历史懒渲染等完整逻辑。

### 影响范围

直接影响：

- 子任务详情页的对话 turn 渲染入口。

不应影响：

- 主会话对话窗口。
- 长历史展示、TTS、Artifacts、本地文件打开、消息重编辑、fork、rail 定位。
- 青数品牌、工作台壳层、内置治理链、登录认证、唤醒/TTS。

### 验证结果

已完成：

- `npm test -- src/renderer/components/cowork/coworkConversationTurns.test.ts`
- `git diff --check`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`

### 收口结论

`ConversationTurnsView` 专项本轮到此收口：当前分支已具备轻量组件 seam 和数据层等价保护，但不执行主会话整包迁移。后续如要继续迁主会话，必须单独开批并以长历史展示、TTS、Artifacts、本地文件打开、消息重编辑、fork、rail 为验收清单。

本轮原则应用：

- `KISS`：只抽子任务详情可用的轻量组件，不重写主会话。
- `YAGNI`：不为了结构一致提前迁移所有主会话能力。
- `SOLID`：展示循环先独立为组件，主会话复杂控制仍留在原组件。
- `DRY`：子任务详情不再复制 turn 渲染循环。

## 2026-05-25 ConversationTurnsView 迁移专项第 2 轮：测试等价保护

### 变更背景

第 1 轮确认 `origin/main` 的完整 `ConversationTurnsView` 迁移风险较高，不应直接整包替换。本轮按规划先补纯数据层等价能力和测试，为后续组件抽取或迁移建立回归保护。

### 改动内容

- 在 `coworkConversationTurns.ts` 中补齐静默 assistant 消息过滤：形如 `NO_REPLY` / `` `NO_REPLY` `` 的消息不再进入展示 items。
- 上下文压缩 system message 后会开启新的 orphan turn，避免压缩事件与前一段 assistant 内容混在同一 turn 中。
- 在 `coworkConversationTurns.test.ts` 中新增两条等价测试，覆盖 `NO_REPLY` 过滤和 context compaction turn 切分。

### 影响范围

直接影响：

- Cowork 主对话与子任务详情共用的 turn 构建结果。
- OpenClaw / IM 同步中可能出现的静默 `NO_REPLY` assistant 消息展示。
- 上下文压缩类 system message 的展示分组。

不应影响：

- 青数品牌、工作台壳层、内置治理链、登录认证、唤醒/TTS。
- 主 UI 结构、Artifacts、本地文件打开、消息重编辑、fork、rail 定位。

### 验证结果

已完成：

- `npm test -- src/renderer/components/cowork/coworkConversationTurns.test.ts`
- `git diff --check`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`

### 后续注意事项

- 下一轮如果继续推进，可做“最小组件抽取评估”：只抽纯展示容器，不迁移主会话功能；若风险仍高，则停止在当前数据层等价保护。
- 仍不建议直接删除 `coworkConversationTurns.ts` 或整包迁入 `ConversationTurnsView.tsx`。

本轮原则应用：

- `KISS`：只补两条纯数据层显示语义。
- `YAGNI`：不为了匹配 main 文件结构而迁移 UI。
- `SOLID`：把消息分组规则留在 turn 构建工具内，组件继续消费稳定结构。
- `DRY`：用现有 `coworkConversationTurns.test.ts` 承接等价覆盖，不新增重复测试体系。

## 2026-05-25 ConversationTurnsView 迁移专项第 1 轮：差异评估与保护边界

### 变更背景

Subagent / `sessions_spawn` 批次收口后，继续按规划评估是否推进 `origin/main` 的 `ConversationTurnsView` 对话渲染拆分。该区域直接影响主会话、子任务详情、Artifacts、TTS、消息重编辑、长历史展示和右侧 rail，因此先做边界评估，不直接整包替换。

### 核对结论

- `origin/main` 已把 `coworkConversationTurns.ts` 拆到 `messageDisplayUtils`，并新增独立 `ConversationTurnsView.tsx` 供主会话和子任务复用。
- 当前分支仍保留 `coworkConversationTurns.ts`，但已经包含关键修复：tool result 配对、thinking 结束后可见、`MEDIA:` token 清理、大 tool result 预览截断。
- 当前分支 `CoworkSessionDetail.tsx` 还承载青数分支需要保护的能力：TTS 播放、Artifacts 本地文件打开、消息重编辑、fork、长历史懒渲染、rail 定位和当前已修过的历史展示逻辑。
- 直接迁入 `ConversationTurnsView` 会删除当前 `coworkConversationTurns.ts`，并大幅改动主对话渲染，风险超过本轮“小步合入”范围。

### 本轮处理

- 本轮只完成扫描与文档化，不新增运行时代码。
- `ConversationTurnsView` 完整迁移暂缓，后续必须作为独立专项执行。

### 后续验收条件

如果后续推进完整迁移，需要至少满足：

- 长历史会话仍能向上滚动查看完整历史，不回退到只能看两三轮。
- TTS、消息重编辑、fork、Artifacts 预览/本地文件打开、rail 定位均保持可用。
- 子任务详情继续复用同一渲染语义，不出现 tool result / tool input 丢失。
- `coworkConversationTurns.test.ts` 中现有用例全部迁移或保留等价覆盖。

### 验证结果

已完成：

- `git diff --check`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`

本轮原则应用：

- `KISS`：先评估边界，不把高耦合渲染拆分混进已收口的 Subagent 批次。
- `YAGNI`：没有为了目录对齐而删除当前已稳定的 `coworkConversationTurns.ts`。
- `SOLID`：明确主会话渲染、子任务详情、Artifacts/TTS 的职责交叉点。
- `DRY`：后续若迁移，必须保留或迁移现有测试，不复制两套 turn 构建逻辑长期并存。

## 2026-05-25 Subagent 小修补批次收口验收

### 变更背景

按上一轮规划继续检查 `origin/main` 剩余 Subagent 低风险 UI 小修复，确认是否还需要继续合入父任务标题返回、侧栏 row polish、子任务详情头部等体验细节。

### 核对结论

- 父任务标题/任务行点击后清空子任务详情选择并返回父会话详情：当前分支已具备。
- 子任务侧栏行已对齐 main 的简化样式：显示 agent label、右侧运行 spinner / 错误态 / duration。
- 子任务详情页已支持折叠侧栏下的侧栏展开、新建对话入口、Mac padding 和可拖拽 header。
- 当前分支刻意继续保留现有 `CoworkSessionDetail` / `coworkConversationTurns` 复用方案，不迁入完整 `ConversationTurnsView` 拆分。

### 影响范围

本轮仅做核对与文档收口，不新增运行时代码改动。

### 验证结果

已完成：

- `git diff --check`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`

### 后续注意事项

- Subagent / `sessions_spawn` 这一小高耦合批次当前已收口，后续剩余属于更大的对话渲染拆分或 OpenClaw runtime 主干重构，应另开专项。
- 如果后续要迁 `ConversationTurnsView`，必须先用当前分支的长历史消息展示作为回归验收用例。

本轮原则应用：

- `KISS`：只确认现有能力是否已覆盖，不为了合入而改动。
- `YAGNI`：不迁入当前不必要的完整渲染拆分。
- `SOLID`：继续保持 runtime、IPC、renderer 展示边界清晰。
- `DRY`：文档引用上一批实现，不重复扩写实现细节。

## 2026-05-25 Subagent 小修补批次：backfill、tool result 与错误态

### 变更背景

上一批已接入 Subagent / `sessions_spawn` 的运行态追踪、侧栏与独立详情页。本批继续按规划从 `origin/main` 筛入低侵入修复，重点处理子任务失败后一直显示运行中、backfill 结果无法补全 session key、以及子任务历史中的 tool result / tool input 展示缺失。

### 改动内容

- `SubagentTracker.onBackfillResult()` 改为独立解析 backfill 文本，补齐 `childSessionKey/sessionKey/key` 与 `status=error` 识别。
- `commitSpawnResult()` 在已有 run 状态下也能更新错误态，避免 spawn timeout / failure 通过 backfill 到达时子任务一直转圈。
- 子任务 session key 发现增强：支持按 run id、agent id、`subagent:<agentId>` 和持久化 run 里的 key 反查。
- 子任务历史解析增强：支持 `tool_result`、`toolresult`、`tool`、`function` 角色，以及 Anthropic user message 中的 `tool_result` 内容块。
- tool input 继续走统一 `resolveToolInput()`，兼容 `input`、`args`、`arguments` JSON string 等多种 gateway 形态。

### 影响范围

直接影响：

- Subagent 失败态与运行态显示准确性。
- Subagent 独立详情页里的工具调用输入和工具结果展示完整性。
- OpenClaw `chat.history` backfill 对子任务历史恢复的稳定性。

不应影响：

- 青数品牌、工作台壳层、内置治理链、登录认证、唤醒/TTS、宠物伙伴。
- 主会话对话渲染主干。
- IM 多实例路由与飞书群聊 Agent 归属。

### 验证结果

已完成：

- `git diff --check`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`

### 后续注意事项

- 下一轮建议继续做第 2 轮验收/收口：补必要文档索引，扫描是否还有 Subagent 低风险 UI 小修复未纳入，并视情况做最小运行态验证。
- 仍不建议在本批混入 `ConversationTurnsView` 整体迁移或 OpenClaw runtime 主干重构。

本轮原则应用：

- `KISS`：只修 Subagent tracker 的 backfill / history 解析，不扩散到主 UI。
- `YAGNI`：没有提前迁入完整对话渲染拆分。
- `SOLID`：gateway 历史解析留在 main runtime 层，renderer 继续只消费 `CoworkMessage`。
- `DRY`：复用 `commitSpawnResult()` 与 `resolveToolInput()`，不复制第二套解析路径。

## 2026-05-25 小高耦合批次：Subagent / sessions_spawn 交互优化

### 变更背景

`origin/main` 在 `sessions_spawn` 子 agent 交互上已经补齐了运行态追踪、会话持久化、侧栏子任务行和独立详情页。当前分支之前只合入了部分 Subagent SQLite 底座，用户侧仍缺少“父任务下看到子 agent 执行过程、点击进入子任务详情、运行中轮询刷新”的完整体验。

本批按 [青数覆盖层-总索引.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/青数覆盖层-总索引.md) 的规则作为“小高耦合批次”处理：只合入 Subagent / `sessions_spawn` 公共交互能力，不整包替换 OpenClaw runtime、主工作台 UI、认证主干或青数治理链。

### 改动内容

- 新增 `SubagentTracker`，追踪 `sessions_spawn`、`sessions_resume`、`sessions_read` 和 `announce:*:subagent:*` 生命周期事件。
- OpenClaw runtime 接入子 agent tracker，在 spawn result 到达后再创建 run 记录，避免未拿到 child session key 时产生不可恢复的脏记录。
- `cowork:subagent:list` 与 `cowork:subTask:history` 优先走运行态 tracker，fallback SQLite 时统一转换成可渲染 `CoworkMessage`，避免 renderer 直接认识数据库行结构。
- Agent 侧栏在当前父任务下展示子任务行，运行中显示 spinner，失败显示错误态，选中子任务时父任务不再同时高亮。
- 新增子 agent 独立详情页，复用当前分支已有对话渲染单元，展示子任务输入、assistant/tool 内容、状态标签和消息计数。
- 补齐子任务相关 i18n 文案，并保留当前分支青数 Agent pin 未持久化的兼容提示，不把 per-agent modelSlice / agentSlice 大迁移混入本批。

### 影响范围

直接影响：

- OpenClaw `sessions_spawn` 子 agent 运行态追踪。
- Agent 侧栏父任务下的子任务展示与选中态。
- 子 agent 历史详情读取与运行中轮询刷新。

不应影响：

- 青数品牌、主工作台壳层和首页展示。
- 青数 managed catalog / managed Agent / managed Skill / managed Tool 治理链。
- 青数登录、Portal、QTB、飞书扫码和认证 bridge。
- 唤醒、语音输入、TTS 与宠物伙伴覆盖层。
- 已修复的 IM 多实例路由和飞书群聊 Agent 归属。

### 验证结果

已完成：

- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`
- `git diff --check`

### 后续注意事项

- 当前实现刻意没有迁入 `origin/main` 的完整 `ConversationTurnsView` 拆分，避免扰动当前分支已经修过的历史消息展示逻辑；后续如继续对齐，需要单独做对话渲染专项。
- `origin/main` 后续仍有 Subagent backfill、tool result display、error detection 等修复提交，下一批可继续按同一 tracker/sidebar/detail 边界小步筛入。
- 如后续要合 OpenClaw 主干重构，应先确认青数 managed tools、认证、IM 路由和任务运行中延后重启策略不会被覆盖。

本轮原则应用：

- `KISS`：只接 `sessions_spawn` 子 agent 主链路，不迁移无关 UI 与 runtime 主干。
- `YAGNI`：不提前做主 Agent 调度器、完整 OpenClaw 主干替换或 per-agent modelSlice 大迁移。
- `SOLID`：runtime 负责事件追踪，IPC 负责数据形态归一，renderer 只做展示。
- `DRY`：子任务详情复用当前会话渲染组件，避免复制第二套消息块实现。

## 2026-05-25 选择性合入 main 公共能力：OpenClaw、Artifacts、Subagent、对话渲染与 SQLite 备份

### 变更背景

远程 `main` 更新后，当前 `qingv1.0` 分支按 [青数覆盖层-总索引.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/青数覆盖层-总索引.md) 的规则做选择性合入：优先吸收公共能力与 bugfix，同时保护青数品牌、主工作台、内置治理链、青数登录、唤醒/TTS、宠物伙伴和 IM 路由修复。

本轮合入锚点已写入索引文档：

- 合入前当前分支 HEAD：`3b4c4e96c3679bf2107cd920179640bc2a8fcbd9`
- 合入后当前分支 HEAD：`b7bc264d27e998a9a23150e8bc5f3669b88310d1`
- 本轮 `origin/main` 终点：`f4287ec74af578f5d7ea6eafc66b4d14096c5aa0`

### 改动内容

- 补入 `main` 的公共 specs 与 shared constants，作为后续小步对齐的稳定基线。
- 对齐 OpenClaw provider custom params 与 secret env 处理，配置文件只保留占位符，真实 secret 只进入运行时环境变量。
- 新增 OpenClaw 配置影响分类，低风险配置变更不再直接诱发 gateway 重启，保留任务运行中延后重启策略。
- IM 配置同步统一走 fingerprint 与 restart impact classifier，降低纯 IM 配置变更导致的无意义重启概率。
- Artifacts 预览浏览器补齐 cookie/cache 清理 IPC 与真实文件校验，降低本地预览清理和无效路径打开风险。
- 新增 Subagent run / message SQLite 持久化底座、只读 store、IPC/preload/type 声明，为后续完整 Subagent runtime/UI 专项留出稳定基础。
- 对话渲染补齐 thinking block 与 media 展示边界：thinking 在 streaming 结束后仍可展示，tool result 中尾随 `MEDIA:` token 不再污染正文。
- SQLite 备份恢复补齐回归测试，覆盖 `.previous` 清理、manifest 存在但备份文件缺失、发布中断后从 `.previous` 恢复。

### 影响范围

直接影响：

- OpenClaw provider 参数、secret 注入、配置变更后的 gateway 重启判断。
- IM 配置同步到 OpenClaw 的重启影响判断。
- Artifacts 本地预览与浏览器缓存清理能力。
- Subagent 会话本地持久化基础能力。
- Cowork 对话中的 thinking 与 tool result 展示。
- SQLite 数据库备份恢复可靠性测试覆盖。

不应影响：

- 青数品牌与主工作台 UI。
- 青数 managed catalog / managed agent / managed skill / managed tool 治理链。
- 青数登录、Portal、QTB、飞书扫码与 bridge 主干。
- 唤醒、语音输入与 TTS。
- 宠物伙伴覆盖层。
- 已修复的飞书群聊 Agent 归属与 IM 多实例路由。

### 验证结果

已完成：

- `npm test -- src/main/libs/openclawConfigImpact.test.ts`
- `npm test -- src/main/libs/openclawConfigSync.runtime.test.ts`
- `npm test -- src/main/libs/openclawChannelSessionSync.test.ts`
- `npm test -- src/renderer/components/cowork/coworkConversationTurns.test.ts`
- `npm test -- src/main/libs/sqliteBackup/sqliteBackupManager.test.ts`
- `npm test -- src/main/libs/sqliteBackup/sqliteBackupRecovery.test.ts`
- `npx tsc --project tsconfig.json --noEmit`
- `npx tsc --project electron-tsconfig.json --noEmit`
- `git diff --check`

补充说明：本轮验证前发现本地 `better-sqlite3` 原生模块 ABI 与当前 Node 不一致，已执行 `npm rebuild better-sqlite3` 重建依赖后通过相关测试。

### 后续注意事项

- 下一轮 `main` 更新扫描起点以索引文档中的 `origin/main=f4287ec74af578f5d7ea6eafc66b4d14096c5aa0` 为准。
- `main.ts`、`preload.ts`、`windowStatePersist`、完整 Subagent runtime/sidebar UI、Artifacts 大面板 UI、POPO/IM 大 UI 迁移仍是高耦合专项，不应混入低风险公共 bugfix 批次。
- 后续如果继续接 Subagent 完整链路，需要验证 OpenClaw runtime 写入、会话列表局部刷新、主 Agent/子 Agent 展示切换以及历史恢复。
- 后续如果继续接 Artifacts 大面板 UI，需要单独验证本地文件超链接、文件夹打开、预览浏览器清理和青数工作台布局是否互相影响。

本轮原则应用：

- `KISS`：按公共能力域小批次合入，不做大面积整包替换。
- `YAGNI`：只落地当前可验证的公共 bugfix 与底座，不提前迁高耦合 UI 主干。
- `SOLID`：配置影响分类、Subagent store、Artifacts browser IPC 都按职责分层。
- `DRY`：SQLite 备份恢复只补回归测试锁住既有行为，不复制恢复逻辑。

## 2026-05-20 IM 多实例机制文档补充：主 Agent 调度边界

### 变更背景

需要明确最近几轮 IM 绑定讨论的边界：如果把 IM 通道绑定到 `main` Agent，`main` 是否可以自动调配其他 Agent 工作。

### 结论

当前实现中，IM 绑定是入口路由能力，不是跨 Agent 调度能力。

- 绑定到 `main`：外部 IM 消息进入 `main` Agent 的 session。
- 绑定到其他 Agent：外部 IM 消息进入对应 Agent 的 session。
- `main` 不会自动把任务派发给其他 Agent。
- 当前 Agent prompt 也明确约束：除非用户显式要求，不要一开始就去找其他 Agent 代办。

### 改动内容

- 在 [IM多实例.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/IM多实例.md) 中新增“主 Agent 绑定 IM 后的调度边界”章节。
- 明确当前可用模式：
  - 稳妥版：业务 IM 实例直接绑定业务 Agent，`main` 作为默认兜底。
  - 总控版：后续单独建设“主 Agent 调度器”，需要设计意图识别、目标 Agent session、结果回传和权限边界。
- 在验收建议中补充：绑定到 `main` 时只验证进入 `main` 会话，不预期自动派发。

### 影响范围

仅文档更新，不改变运行时代码。

### 后续注意事项

如果后续要做“主 Agent 调度器”，应作为独立专项实现，不能把 `platformAgentBindings` 直接扩展成隐式派单逻辑，否则容易破坏 IM 会话归属、青数 managed Agent 治理链和工具权限边界。

## 2026-05-20 飞书群 @ 消息 Agent 归属修复

### 变更背景

飞书 bot 绑定到某个 Agent 后，私聊消息会进入该 Agent 的 session 列表；但在飞书群内 `@bot` 后，消息会出现在 `main` Agent 的 session 列表中。

### 根因

OpenClaw runtime 已经把群消息路由到了绑定 Agent，群聊 sessionKey 中也带有已路由出的 Agent：

```text
agent:qingshu-managed-qingshu-presales-analysis:feishu:group:oc_xxx
```

但本地 `openclawChannelSessionSync` 旧逻辑主要依赖 accountId 反查 `platformAgentBindings`。私聊 key 带 accountId，可以匹配实例绑定；群聊 key 不带 accountId，只能走平台级兜底，最终落到 `main`。

同时青数 managed Agent 的本地 ID 含冒号，例如 `qingshu-managed:qingshu-presales-analysis`；OpenClaw key 中可能使用安全化形式 `qingshu-managed-qingshu-presales-analysis`。旧逻辑没有做这层等价匹配。

### 改动内容

- 在 [openclawChannelSessionSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawChannelSessionSync.ts) 中新增 OpenClaw agent key 与本地 Agent ID 的等价匹配。
- `sessionKey` 带 accountId 时，继续优先按实例绑定反查，保持多实例行为不变。
- `sessionKey` 不带 accountId 时，优先尊重 OpenClaw 已路由出的非 `main` Agent。
- 已存在的 `main` mapping 收到新的绑定 Agent 群聊 key 时，会创建新 Agent session 并更新 mapping，避免后续群消息继续落到主 Agent。
- 在 [openclawChannelSessionSync.test.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawChannelSessionSync.test.ts) 中新增飞书群聊无 accountId 的回归测试。
- 在 [IM多实例.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/IM多实例.md) 中补充原因、修复规则和验收项。

### 与 main 分支对齐结论

已核对 `origin/main`：`main` 已有多实例 accountId 匹配能力，但还没有覆盖“飞书群聊 key 不带 accountId，需要从 OpenClaw key agentId 反推本地 Agent”的场景。

当前分支保留 `main` 的多实例匹配方式，并补齐该公共 bugfix。

### 影响范围

直接影响：

- 飞书群聊 `@bot` 触发后的本地 session 归属。
- OpenClaw channel session 同步到 QingShuClaw 本地列表的 Agent 映射。

不应影响：

- 飞书私聊多实例路由。
- OpenClaw runtime 的实际消息处理。
- 青数品牌、工作台、内置治理链。
- 唤醒/TTS。

### 验证结果

- `npm test -- src/main/libs/openclawChannelSessionSync.test.ts src/main/libs/openclawConfigSync.runtime.test.ts`
- `npx tsc --project electron-tsconfig.json --noEmit`

## 2026-05-20 飞书群白名单 OpenClaw 语义适配

### 变更背景

飞书实例绑定 Agent 后，群策略设为 `open` 可以响应；但设为 `allowlist` 并填入正确群 `chat_id` 后，群内 `@bot` 不响应。

### 根因

当前 OpenClaw runtime 已将飞书群聊权限拆成两个语义：

- `groups` 控制允许哪些群，key 是群 `chat_id`，通常形如 `oc_xxx`。
- `groupAllowFrom` 控制允许哪些群成员触发，值是用户 `open_id`，通常形如 `ou_xxx`。

青数 UI 仍沿用旧使用方式，把群 `chat_id` 填进 `groupAllowFrom`。在新版 OpenClaw 中，这会被当成发送人白名单，导致真实群成员无法匹配。

### 改动内容

- 在 [openclawConfigSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigSync.ts) 中新增飞书群白名单投影兼容逻辑。
- 投影到 OpenClaw 时：
  - `oc_xxx` 自动写入 `channels.feishu.accounts.<accountId>.groups`。
  - `ou_xxx` 保留在 `groupAllowFrom`。
  - 重复项自动去重。
  - 默认保留 `requireMention=true`。
- 在 [openclawConfigSync.runtime.test.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigSync.runtime.test.ts) 中新增回归测试，覆盖旧 UI 输入到新版 OpenClaw 配置的转换。
- 在 [IM多实例.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/IM多实例.md) 中补充飞书群白名单旧/新语义、main 对齐结论与验收建议。

### 与 main 分支对齐结论

已对最新 `FETCH_HEAD` 的 `main` 核对：`main` 当前仍把 `groupAllowFrom` 原样投影到 OpenClaw，尚未完成该 runtime 新语义适配。

本次属于基于当前 vendored OpenClaw runtime 的公共 bugfix 先行修复。后续合入 main 时需要保留该兼容逻辑，直到 main 也完成同类适配。

### 影响范围

直接影响：

- 飞书群聊 `allowlist` 策略。
- 飞书多实例配置到 OpenClaw runtime 的投影。

不应影响：

- 飞书私聊。
- Agent 绑定关系。
- 青数品牌、工作台、内置治理链。
- 唤醒/TTS。

### 验证结果

已新增定向测试，验证 `oc_xxx` 不再写入 OpenClaw `groupAllowFrom`，而是进入 `groups`。

## 2026-05-20 Agent IM 多实例绑定保存与机制文档

### 变更背景

在 Agent 设置弹窗的“IM 渠道”中选择或变更 IM 渠道后，底部保存按钮在部分场景下仍保持置灰，无法保存。

典型场景：

- 青数 managed/readOnly Agent 中只调整 IM 渠道绑定。
- 未修改额外 Skill，仅修改飞书、钉钉、邮箱等 IM 实例绑定。

### 根因

编辑弹窗中 managed/readOnly Agent 的保存按钮只判断 `hasManagedExtraSkillChanges`，没有把 IM 绑定变化纳入可保存条件。

同时 managed/readOnly Agent 的保存分支只保存额外 Skill，没有持久化 `platformAgentBindings`，导致 UI 选择了 IM 渠道但保存入口不承认这次变更。

### 改动内容

- 在 [AgentSettingsPanel.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/AgentSettingsPanel.tsx) 中新增 `hasImBindingChanges` 判断。
- managed/readOnly Agent 中只要 IM 绑定发生变化，保存按钮即可点亮。
- managed/readOnly Agent 保存时：
  - 如果额外 Skill 变化，则继续保存额外 Skill。
  - 如果 IM 绑定变化，则保存 `IMSettings.platformAgentBindings` 并触发 IM/OpenClaw 配置同步。
  - 不修改青数 managed Agent 的品牌、人设、内置治理链等只读业务字段。
- 普通 Agent 保存逻辑复用同一个 `hasImBindingChanges` 判断，避免重复计算。
- 新增 [IM多实例.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/IM多实例.md)，系统梳理 IM 多实例与 Agent 绑定机制。

### IM 多实例机制沉淀

[IM多实例.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/IM多实例.md) 已覆盖：

- IM 绑定后的实际效果。
- 飞书多实例示例。
- 默认 `main` Agent 回退逻辑。
- 实例级绑定优先、平台级绑定兜底。
- 同一 IM 实例绑定互斥。
- 绑定变更后新旧 session 的处理方式。
- OpenClaw `bindings` 配置投影。
- 代码索引与验收建议。

### 影响范围

直接影响：

- Agent 设置弹窗的“IM 渠道”保存能力。
- 青数 managed/readOnly Agent 的 IM 路由绑定配置。
- IM 多实例到 Agent 的归属说明文档。

不应影响：

- 青数品牌内容。
- 主工作台 UI。
- 青数内置治理链。
- 唤醒/TTS。
- Agent 的 managed descriptor、人设和内置 Skill 真源。

### 验证结果

已验证：

- `npx tsc --project tsconfig.json --noEmit`
- `npm test -- src/renderer/components/agent/agentDraftState.test.ts src/renderer/components/agent/agentImBindingConfig.test.ts`
- `npx eslint src/renderer/components/agent/AgentSettingsPanel.tsx src/renderer/components/agent/agentDraftState.ts src/renderer/components/agent/agentDraftState.test.ts src/renderer/components/agent/agentImBindingConfig.ts src/renderer/components/agent/agentImBindingConfig.test.ts`

并已基于该修复打出新的 `.app` 测试包：

- [release/mac-arm64/QingShuClaw.app](/Users/wuyongsheng/workspace/projects/QingShuClaw/release/mac-arm64/QingShuClaw.app)

### 后续注意事项

- 后续每次调整 Agent 设置、IM 多实例、OpenClaw `bindings` 投影时，都需要同步追加本 changelog。
- IM 绑定属于路由层配置，不应反向修改青数 managed Agent 的后端 descriptor。
- 同一个 IM 实例绑定是互斥的，UI 和持久化层都应保持 `platform:instanceId -> agentId` 的单归属模型。
- 绑定变更后不要强行迁移旧 session 历史，优先创建新 Agent session，避免上下文污染。

## 1. 文档目的

本文记录当前分支 `qingshu-dev` 相对远程 `origin/main` 的全部已知差异，并补充当前工作区未提交改动与后续本地开发注意事项，供后续继续开发、回顾和合并时参考。

生成口径：

- 已提交差异：基于 `git diff origin/main...HEAD`
- 未提交差异：基于当前工作区 `git diff HEAD`
- 生成时间：2026-04-02

说明：

- 当前分支相对 `origin/main` 额外包含 2 个提交，其中真正承载业务差异的是 `86a70c1 feat(auth): backup current qingshu-dev workspace`
- 当前工作区存在未提交改动，这部分已单独列出，避免与已提交差异混淆

## 2. 相对 Main 的已提交差异

### 2.1 青书认证体系接入

这是当前分支相对主分支最核心的业务差异。

涉及文件：

- [src/common/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/common/auth.ts)
- [src/main/auth/config.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/auth/config.ts)
- [src/main/auth/adapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/auth/adapter.ts)
- [src/main/main.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/main.ts)
- [src/main/preload.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/preload.ts)
- [src/renderer/services/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/auth.ts)
- [src/renderer/store/slices/authSlice.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/store/slices/authSlice.ts)
- [src/renderer/types/electron.d.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/types/electron.d.ts)

主要内容：

- 新增统一认证常量与类型：
  - `AuthBackend`
  - `AuthConfig`
  - `BridgeTarget`
  - 飞书扫码会话类型
  - 桥接票据与桥接会话类型
- 新增 `Qtb` 认证后端配置解析
- 主进程新增独立认证适配层，支持：
  - 账号密码登录
  - 飞书扫码登录
  - bridge ticket 创建与兑换
  - token 刷新
  - 用户信息 / 额度 / 模型列表获取
- 渲染进程认证服务改为通过统一接口驱动主进程能力
- `electron` 预加载与类型声明中补充认证 IPC 能力

业务目标：

- 将客户端认证接入青数平台用户体系
- 让桌面端具备与 Web 一致的身份来源
- 为桌面端与青数 Web 之间的双向免登打基础

### 2.2 青书 Web 桥接与双向免登

涉及文件：

- [docs/qingshu-auth-bridge-overview.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/docs/qingshu-auth-bridge-overview.md)
- [qtb-auth-integration-acceptance.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/qtb-auth-integration-acceptance.md)
- [src/common/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/common/auth.ts)
- [src/main/auth/adapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/auth/adapter.ts)
- [src/renderer/services/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/auth.ts)
- [src/renderer/components/LoginButton.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/LoginButton.tsx)

主要内容：

- 引入 `BridgeTarget.Web` / `BridgeTarget.Desktop`
- 支持创建 bridge ticket 并交换成目标端会话
- 客户端登录后可跳转到青数 Web
- 为青数 Web 回到桌面端预留桥接数据结构

### 2.3 登录 UI 与品牌化改造

涉及文件：

- [src/renderer/components/LoginButton.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/LoginButton.tsx)
- [src/renderer/components/Settings.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/Settings.tsx)
- [src/renderer/components/Sidebar.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/Sidebar.tsx)
- [src/renderer/services/i18n.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/i18n.ts)
- [src/main/i18n.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/i18n.ts)
- [src/renderer/constants/app.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/constants/app.ts)
- [src/main/appConstants.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/appConstants.ts)

主要内容：

- 登录入口从原先偏 LobsterAI 风格调整为青书 / 灵工打卡品牌表达
- 登录菜单中加入青数 Web 跳转逻辑
- 设置页新增认证后端配置项：
  - 青数 API 地址
  - 青数 Web 地址
- 中英文文案补充青书认证、桥接与品牌说明
- 侧边栏和关于页改为青书产品语义

### 2.4 图标与打包资源替换

涉及文件：

- [build/icons/mac/icon.icns](/Users/wuyongsheng/workspace/projects/QingShuClaw/build/icons/mac/icon.icns)
- [build/icons/win/icon.ico](/Users/wuyongsheng/workspace/projects/QingShuClaw/build/icons/win/icon.ico)
- [build/icons/png/1024x1024.png](/Users/wuyongsheng/workspace/projects/QingShuClaw/build/icons/png/1024x1024.png)
- [public/logo.png](/Users/wuyongsheng/workspace/projects/QingShuClaw/public/logo.png)
- [resources/tray/tray-icon.png](/Users/wuyongsheng/workspace/projects/QingShuClaw/resources/tray/tray-icon.png)
- [resources/tray/tray-icon.ico](/Users/wuyongsheng/workspace/projects/QingShuClaw/resources/tray/tray-icon.ico)
- [resources/tray/tray-icon-mac.png](/Users/wuyongsheng/workspace/projects/QingShuClaw/resources/tray/tray-icon-mac.png)

主要内容：

- 桌面图标、托盘图标、前端 logo 替换为青书品牌资源
- 对应打包资源同步更新

### 2.5 应用配置与打包参数调整

涉及文件：

- [package.json](/Users/wuyongsheng/workspace/projects/QingShuClaw/package.json)
- [electron-builder.json](/Users/wuyongsheng/workspace/projects/QingShuClaw/electron-builder.json)
- [scripts/electron-builder-hooks.cjs](/Users/wuyongsheng/workspace/projects/QingShuClaw/scripts/electron-builder-hooks.cjs)
- [index.html](/Users/wuyongsheng/workspace/projects/QingShuClaw/index.html)
- [src/renderer/config.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/config.ts)

主要内容：

- 将认证配置纳入 `app_config`
- 调整应用品牌名称与部分打包元数据
- 为青书认证默认地址提供默认值

### 2.6 文档与调研资产

涉及文件：

- [QingShuClaw架构梳理.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/QingShuClaw架构梳理.md)
- [docs/qingshu-auth-bridge-overview.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/docs/qingshu-auth-bridge-overview.md)
- [qtb-auth-integration-acceptance.md](/Users/wuyongsheng/workspace/projects/QingShuClaw/qtb-auth-integration-acceptance.md)

主要内容：

- 补充当前项目的结构梳理
- 记录青书认证、双向免登与验收口径

### 2.7 分支中不建议继续保留的差异

以下内容虽然当前存在于分支差异中，但不属于核心业务能力，建议后续视情况清理：

- `.idea/` 目录被纳入版本差异：
  - [.idea/.gitignore](/Users/wuyongsheng/workspace/projects/QingShuClaw/.idea/.gitignore)
  - [.idea/QingShuClaw.iml](/Users/wuyongsheng/workspace/projects/QingShuClaw/.idea/QingShuClaw.iml)
  - [.idea/modules.xml](/Users/wuyongsheng/workspace/projects/QingShuClaw/.idea/modules.xml)
  - [.idea/vcs.xml](/Users/wuyongsheng/workspace/projects/QingShuClaw/.idea/vcs.xml)
- 第三方 vendor 文件存在分支内修改：
  - [SKILLs/technology-news-search/scripts/vendor/rss-parser.bundle.js](/Users/wuyongsheng/workspace/projects/QingShuClaw/SKILLs/technology-news-search/scripts/vendor/rss-parser.bundle.js)

建议：

- `.idea/` 优先从版本控制中剥离
- vendor 文件若必须修改，补上来源说明、版本基线与变更原因

## 3. 当前工作区未提交差异

以下内容尚未提交，但已经存在于当前工作区，因此也属于“当前分支现状”的一部分。

涉及文件：

- [public/logo.png](/Users/wuyongsheng/workspace/projects/QingShuClaw/public/logo.png)
- [src/common/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/common/auth.ts)
- [src/main/auth/adapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/auth/adapter.ts)
- [src/main/main.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/main.ts)
- [src/main/preload.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/preload.ts)
- [src/renderer/components/LoginButton.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/LoginButton.tsx)
- [src/renderer/components/Settings.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/Settings.tsx)
- [src/renderer/components/Sidebar.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/Sidebar.tsx)
- [src/renderer/components/cowork/CoworkPromptInput.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/cowork/CoworkPromptInput.tsx)
- [src/renderer/services/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/auth.ts)
- [src/renderer/services/i18n.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/i18n.ts)
- [src/renderer/types/electron.d.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/types/electron.d.ts)

### 3.1 飞书扫码登录继续演进

主要方向：

- 新增 `AuthLoginMode`，准备把登录分为“扫码模式”和“手动模式”
- 主进程新增 `auth:openFeishuScanWindow`
- 认证服务新增：
  - 扫码会话缓存
  - 超时控制
  - IPC 失败后的 `api.fetch` 降级
  - 扫码窗口打开能力
- 认证适配层新增：
  - 会话态请求封装
  - 403 / 鉴权失败自动 refresh 后重试
  - 飞书扫码窗口 URL 计算逻辑

目标：

- 让飞书扫码登录更稳定
- 减少本机 9080 / IPC / 登录中转链路导致的失败
- 为同机浏览器扫码与嵌入式扫码页提供双路径支持

### 3.2 登录面板重构

主要方向：

- 登录面板引入二维码展示
- 登录入口区分扫码登录与手动登录
- 增加本地回调地址检测与扫码提示
- 登录状态轮询与二维码过期刷新逻辑更完整

### 3.3 品牌文案继续收口

主要方向：

- 设置页 About 区重新组织为“产品定位 / 平台 / 数据范围”
- 侧边栏补充品牌签名
- 中英文 i18n 新增灵工打卡 / 青数平台相关文案
- logo 资源继续调整

### 3.4 其他当前工作区小改动

- [src/renderer/components/cowork/CoworkPromptInput.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/cowork/CoworkPromptInput.tsx)
  - 用常量空数组替换内联 `[]`，减少不必要引用变化

## 4. 后续本地开发注意事项

### 4.1 高冲突热点文件

以下文件与 `main` 的交叉频率高，后续开发尽量小步提交、避免一次改太多：

- [src/main/main.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/main.ts)
- [src/main/preload.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/preload.ts)
- [src/main/auth/adapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/auth/adapter.ts)
- [src/renderer/components/LoginButton.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/LoginButton.tsx)
- [src/renderer/components/Settings.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/Settings.tsx)
- [src/renderer/services/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/auth.ts)
- [src/renderer/services/i18n.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/i18n.ts)
- [src/renderer/types/electron.d.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/types/electron.d.ts)

建议：

- 每次改动先 `git fetch origin main`
- 开发前先看 `git diff origin/main...HEAD -- <file>`
- 冲突热点文件优先按功能拆提交，不要把品牌、认证、样式混在一个提交里

### 4.2 认证相关改动约束

建议遵循以下边界，避免职责打散：

- 公共认证类型只放在 [src/common/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/common/auth.ts)
- 主进程认证编排只放在 [src/main/main.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/main.ts)
- 具体后端协议与刷新逻辑只放在 [src/main/auth/adapter.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/auth/adapter.ts)
- `preload` 只暴露最小 IPC 接口，不放业务判断
- 渲染进程只通过 [src/renderer/services/auth.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/auth.ts) 调认证能力

这符合：

- `KISS`：每层职责更清晰
- `SOLID`：认证协议细节不泄漏到 UI 层
- `DRY`：避免同一刷新逻辑在 main / renderer 各写一份

### 4.3 品牌与文案改动约束

后续只要修改以下内容，必须同步检查中英文文案是否成对更新：

- [src/renderer/services/i18n.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/services/i18n.ts)
- [src/main/i18n.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/i18n.ts)

注意：

- 不要直接在组件里硬编码“灵工打卡”“青数”“QingShuClaw”等展示文案
- 品牌名、产品名、平台名尽量保持固定口径，避免同一页面混用

### 4.4 资源文件改动约束

图标与 logo 文件体积大、二进制不可读、非常容易造成无意义冲突。

建议：

- 资源改动单独成 commit
- 每次更新资源时记录来源文件、导出尺寸、用途
- 没有明确品牌变更时，不要顺手覆盖 `logo` / `tray` / `build/icons`

### 4.5 IDE 与本地环境文件约束

建议尽快处理 `.idea/`：

- 若无协作必要，移出版本控制
- 若确实要保留，至少固定规则，不要把个人环境路径和临时配置带进来

### 4.6 与 Main 保持同步的建议流程

推荐流程：

1. 开发前执行 `git fetch origin main`
2. 先看 `git log --oneline HEAD..origin/main`
3. 若主分支改到了认证、设置、i18n、preload、main 这些热点文件，优先先合并再开发
4. 功能完成后先跑 `npm run build`
5. 提交前更新本文件中的“当前工作区未提交差异”部分，避免文档与代码脱节

### 4.7 当前最建议尽快处理的事项

- 将当前工作区 12 个未提交文件整理成 1 到 2 个清晰提交
- 将 `.idea/` 是否纳入版本控制做出明确决策
- 对二维码扫码链路补一次人工联调，重点验证：
  - 本机 9080 服务可用
  - 扫码过期刷新
  - 授权成功后客户端自动登录
  - localhost 回调与手机扫码场景差异

## 5. 维护建议

后续每次该分支新增与 `main` 的显著差异时，优先更新本文件，而不是依赖口头记忆。

推荐更新顺序：

1. 先补“相对 Main 的已提交差异”
2. 再补“当前工作区未提交差异”
3. 若出现新的冲突热点，再更新“后续本地开发注意事项”
