# QingShuClaw FAQ

## 上传 3.8M 图片后为什么会报 `RangeError: Maximum call stack size exceeded`，并在运行快结束时提示“AI 引擎正在重启，请稍后重试”？

### 现象

- 在对话输入框中上传约 3.8M 的图片后，前端或 Electron IPC 链路可能报 `RangeError: Maximum call stack size exceeded`。
- 当前轮任务接近结束时，界面又出现“AI 引擎正在重启，请稍后重试。”。
- 这两个现象容易被误判为 OpenClaw 网关本身不可用，但实际主因是大图片 payload 在非必要链路中被重复保存、复制和回传，导致进程间传输与渲染压力过大。

### 根因链路

图片附件的原始链路是：

1. `src/renderer/components/cowork/CoworkPromptInput.tsx` 将图片读取成 Data URL，并提取出 `base64Data`。
2. 前端通过 `imageAttachments` 把图片传给主进程。
3. 主进程再把图片随本轮请求传给 OpenClaw 或 Claude SDK，这一步是必要的，因为模型需要看到图片。
4. 旧逻辑同时把完整 `base64Data` 写入会话消息 `metadata.imageAttachments`，并通过 IPC 返回给前端展示。
5. 会话列表、当前会话、临时消息、SQLite 持久化和 React 渲染都会接触这段大字符串，导致大对象被多次结构化克隆、序列化、遍历和渲染。

3.8M 的二进制图片转成 base64 后通常会膨胀到约 5M，再叠加 Data URL、消息 metadata、IPC structured clone、Redux/React 状态复制和历史消息回放，风险会被放大。最终表现就可能是调用栈溢出，而不是普通的“文件太大”错误。

### 为什么会伴随“AI 引擎正在重启”

“AI 引擎正在重启，请稍后重试。”来自 cowork 错误分类与 OpenClaw 网关生命周期保护逻辑。大图片导致当前 turn 的 IPC、持久化或渲染链路过载后，前端可能错过正常完成事件，或者运行时进入错误/重启/排水状态。此时后续请求碰到网关重启窗口，就会显示该提示。

因此它不是本次问题的第一原因，而是大图片 payload 触发链路压力后的级联体验问题。修复重点不是简单延长重启等待时间，而是避免把图片正文放进不需要它的会话元数据、IPC 响应和 UI 状态里。

### 本次修复

本次修复采用“运行时保留正文，展示与持久化只保留摘要”的策略：

- 新增 `src/common/coworkImageAttachments.ts`，统一提供图片附件摘要与 payload 剥离逻辑。
- OpenClaw / Claude SDK 当前请求仍然收到完整 `base64Data`，保证模型可以正常识图。
- `coworkStore` 写入用户消息时，不再保存完整 `base64Data`，只保存 `name`、`mimeType`、`sizeBytes`、`base64Length`。
- `sanitizeCoworkMessageForIpc()` 在会话通过 IPC 返回前再次剥离图片正文，作为兜底保护。
- 前端临时会话消息也只保存摘要，避免新建会话瞬间就把大 base64 放入 Redux 当前会话。
- 历史消息展示中，如果 metadata 只有摘要，就显示图片文件 chip 和大小；只有旧数据或当前临时内存中仍含 base64 时，才显示内联预览。
- 重新编辑历史消息时，只恢复仍带内联 payload 的图片，避免从摘要恢复出不可发送的伪附件。

### 进一步对齐 Codex 后的机制

Codex 的做法是 UI 和历史状态只保存本地图片引用，真正请求模型时才把图片读出来并序列化为图片内容。本分支按同样思路做了第二层收口：

- renderer 输入框和队列中的图片附件改为 `{ name, mimeType, path, sizeBytes }` 这类轻量引用，不再从 `dataUrl` 提取 `base64Data` 作为 IPC 输入。
- 图片预览仍可以按需调用 `dialog:readFileAsDataUrl` 懒加载缩略图，但这个 Data URL 只用于当前 UI 预览，不作为提交 payload 和历史真源。
- 主进程新增统一转换边界：`cowork:session:start` / `cowork:session:continue` 收到图片路径后，进入 runtime 前再读取文件并转换为 `{ name, mimeType, base64Data }`。
- OpenClaw 和 Claude SDK runtime 仍然接收原来的 base64 结构，因此不改变 OpenClaw `chat.send` 协议，也不会影响网关侧已有的大图 media store/offload 逻辑。
- 旧的 base64 输入保留兼容，但只作为运行时短生命周期 payload 使用；一旦进入消息 metadata、IPC 返回或历史展示，仍会被摘要化。

这相当于把“图片正文”限制在一个很窄的生命周期内：本地文件路径进入 main，main 在请求前读文件，runtime 使用后结束；UI、Redux、SQLite 和会话历史只看到摘要或引用。这样既贴近 Codex 的低压力链路，也避免改动 OpenClaw 协议带来的兼容风险。

### 后续开发注意事项

- 不要把大文件正文、base64、Data URL 写入会话 metadata、Redux 历史状态、SQLite 展示数据源或 IPC 广播体。
- 需要模型消费的文件正文应只存在于“本次请求”的 runtime payload 中。
- UI 展示历史附件时优先使用摘要、文件路径、缓存 key 或对象存储 URL，不要依赖历史消息内嵌 base64。
- 新增图片能力时，优先传 `path/cacheId/url` 这类轻量引用，再在唯一的运行时边界解析为模型需要的格式。
- 如果后续要支持历史图片重新发送，应该引入受控的附件缓存或本地文件引用，而不是重新把 base64 长期塞回消息 metadata。
- 对 OpenClaw 网关重启提示的优化，应优先减少上游过载和级联失败，再考虑调整重启排水窗口。

### 验证建议

- 上传 3M 到 5M 图片发起对话，确认模型仍可识别图片内容。
- 刷新或重新打开会话，确认历史消息只展示图片名称和大小，不再持有完整 base64。
- 检查 SQLite 中对应 user message 的 `metadata.imageAttachments`，确认不存在 `base64Data`。
- 检查 IPC 返回的 session message，确认不存在大段 base64。
- 观察同一轮任务结束阶段，不应再因为图片 metadata 复制压力触发调用栈溢出或诱发网关重启提示。
