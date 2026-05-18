# 青数 managed tools 原生 MCP 适配专项设计

## 1. 调查目的

本专项要解决的问题是：在不影响青数品牌、工作台、内置治理链、登录认证、唤醒/TTS 的前提下，为青数 managed tools 建立等价的 OpenClaw 原生 MCP server 路径，随后再考虑移除 `McpServerManager` 和 `/mcp/execute` bridge。

## 2. 调查结论

### 2.1 当前分支现状

当前青数 managed tools 不是一个独立 MCP server，而是一个进程内 local server registration：

1. `src/main/qingshuManaged/catalogService.ts` 通过 `registerLocalToolRuntime(mcpServerManager)` 注册运行时。
2. 该方法读取 managed catalog snapshot 中 `allowed=true` 的 tools，并组装 `McpToolManifestEntry[]`。
3. `mcpServerManager.registerLocalServer({ name: 'qingshu-managed', tools, callTool })` 把工具挂进 `McpServerManager.localServers`。
4. OpenClaw 调用 `mcp-bridge` plugin 后，`McpBridgeServer` 的 `/mcp/execute` 再调用 `mcpServerManager.callTool(...)`。
5. `mcpServerManager.callTool(...)` 识别到 local server 后，最终回到 `catalogService.invokeManagedTool(...)`。
6. `invokeManagedTool(...)` 使用当前青数认证态请求后端 `/api/qingshu-claw/managed/tools/:toolName/invoke`。

### 2.2 `origin/main` 的 MCP 形态

`origin/main` 已删除 `McpServerManager`，MCP 管理职责改为：

1. Electron 只保存 MCP server 配置，并在 `main.ts` 中读取 `getMcpStore().getEnabledServers()`。
2. `resolveStdioCommand(...)` 只负责把 stdio command 预解析成 OpenClaw 可启动的配置。
3. `openclawConfigSync.ts` 把 resolved servers 写入 `openclaw.json` 的 `mcp.servers`。
4. MCP server 的连接、工具发现、工具调用由 OpenClaw gateway 原生 MCP client 负责。
5. `McpBridgeServer` 仅保留 `/askuser`，不再提供 `/mcp/execute`。

### 2.3 关键差异

青数 managed tools 当前依赖的是 in-process 函数注册；OpenClaw 原生 MCP 需要的是一个真正可连接的 MCP server。两者之间缺少一层“青数 managed tools 原生 MCP server”。

因此，不能直接删除 `McpServerManager`。必须先把 `registerLocalToolRuntime(...)` 的能力迁成独立 HTTP MCP endpoint，再由 `openclawConfigSync` 写入 `mcp.servers.qingshu-managed`。

## 3. 目标架构

目标链路：

```text
QingShuManagedCatalogService
  ├─ 提供 allowed tools snapshot
  └─ 提供 invokeManagedTool(toolName, args, signal)

QingShuManagedMcpServer
  ├─ 监听 127.0.0.1 随机端口
  ├─ 暴露 /mcp streamable-http endpoint
  ├─ 根据 catalog snapshot 注册 tools
  └─ tool call 转发到 catalogService.invokeManagedTool(...)

OpenClawConfigSync
  └─ 写入 openclaw.json:
     mcp.servers["qingshu-managed"] = {
       url: "http://127.0.0.1:<port>/mcp",
       transport: "streamable-http",
       headers: { "x-qingshu-managed-mcp-secret": "${QINGSHU_MANAGED_MCP_SECRET}" }
     }

OpenClaw Gateway
  ├─ 原生连接 qingshu-managed MCP server
  ├─ listTools 获取青数 managed tools
  └─ callTool 触发后端 managed tool invoke
```

## 4. 推荐方案

### 4.1 推荐采用主进程内 Streamable HTTP MCP server

推荐新增 `src/main/qingshuManaged/managedMcpServer.ts`，在 Electron main process 内启动一个本地 HTTP MCP server。

原因：

1. `KISS`：不引入额外子进程，不新增打包 runtime。
2. `SOLID`：把“managed catalog 真源”和“MCP transport 暴露”分成两个类。
3. `DRY`：复用 `catalogService.invokeManagedTool(...)`，不重复实现后端 invoke/auth 逻辑。
4. `YAGNI`：先只支持青数 managed tools，不提前泛化成所有 local tools 运行时。

### 4.2 不推荐直接复用 `McpServerManager`

`McpServerManager` 的职责是旧 bridge 的 MCP client 管理器，保留它会继续绑定 `/mcp/execute` 旧路径。专项目标是让 OpenClaw 原生 MCP client 直接连接青数 managed tools，因此需要迁出它，而不是继续扩展它。

### 4.3 不推荐新增 stdio 子进程 server

stdio 子进程可以工作，但会带来额外打包、认证态同步、端口/环境变量传递和进程生命周期问题。当前青数 managed tools 的调用依赖主进程内 auth adapter 和 catalog snapshot，放在主进程内做 HTTP MCP server 更直接。

## 5. 设计细节

### 5.1 新增 `QingShuManagedMcpServer`

建议职责：

1. `start(): Promise<{ url: string; secret: string }>`
2. `stop(): Promise<void>`
3. `refreshTools(): void`
4. `getServerConfig(): { url: string; headers: Record<string, string> } | null`

内部能力：

1. 使用 `@modelcontextprotocol/sdk/server/mcp.js` 的 `McpServer`。
2. 使用 `@modelcontextprotocol/sdk/server/streamableHttp.js` 的 `StreamableHTTPServerTransport`。
3. 监听 `127.0.0.1` 随机端口，只暴露 `/mcp`。
4. 请求头校验 `x-qingshu-managed-mcp-secret`，防止本机其他进程误调。
5. 每次 catalog 变化时重建 MCP server 或重新注册工具。

### 5.2 调整 `QingShuManagedCatalogService`

建议把当前私有能力拆出可复用接口：

1. 新增 `getManagedToolRuntimeManifest(): McpToolManifestEntryLike[]`。
2. 将 `invokeManagedTool(...)` 改为 public 或新增 public wrapper `invokeManagedMcpTool(...)`。
3. 保留旧的 `registerLocalToolRuntime(...)` 作为过渡期兼容，直到 bridge 完全删除。

注意：这里不要改变 managed catalog 的真源规则。tools 仍来自后端 catalog snapshot，本地只做投影。

### 5.3 调整 `main.ts`

分阶段接入：

1. 新增 `let qingShuManagedMcpServer: QingShuManagedMcpServer | null = null`。
2. 在 OpenClaw 启动前启动 AskUser server 和 QingShu managed MCP server。
3. 在登录成功、退出登录、catalog sync 成功后刷新 managed MCP server。
4. 在 `getResolvedMcpServers()` 中追加 `qingshu-managed` server config。
5. 只有当 native path 验证稳定后，再删除 `mcpServerManager` 初始化和 bridge execute 路径。

### 5.4 调整 `openclawConfigSync.ts`

当前已具备 `getResolvedMcpServers?: () => ResolvedMcpServer[]` 和 `buildOpenClawMcpServers(...)`，专项只需确保：

1. `qingshu-managed` 作为 `transportType='http'` 写入。
2. headers 通过 `lowercaseHeaderKeys(...)` 归一化。
3. `transport: 'streamable-http'` 正确写入。
4. 没有登录态或没有 allowed tools 时，不写入 `qingshu-managed`，避免 OpenClaw 连接空 server。

## 6. 分阶段实施计划

### A 轮：设计与测试骨架

目标：

1. 新增本设计文档。
2. 补充单元测试计划和类型边界。
3. 不修改运行主链路。

验收：

1. `git diff --check`
2. `npx tsc --project tsconfig.json --noEmit`
3. `npx tsc --project electron-tsconfig.json --noEmit`

### B 轮：新增 native managed MCP server，但不接管默认链路

目标：

1. 新增 `src/main/qingshuManaged/managedMcpServer.ts`。
2. 新增单元测试，覆盖工具注册、鉴权、tool call 转发、无登录态空配置。
3. 只通过内部测试启动，不写入默认 OpenClaw config。

验收：

1. managed MCP server 定向测试通过。
2. 旧 `mcp-bridge` 路径仍可编译和测试。

### C 轮：灰度接入 OpenClaw 原生 `mcp.servers`

目标：

1. 在 `main.ts` 中启动 `QingShuManagedMcpServer`。
2. 通过环境变量 `QINGSHU_MANAGED_NATIVE_MCP=1` 将 `qingshu-managed` 写入 `mcp.servers`。
3. 默认继续保留旧 bridge，避免生产路径突变。

验收：

1. 开启 flag 后 `openclaw.json` 出现 `mcp.servers.qingshu-managed`。
2. 未开启 flag 时行为不变。
3. 登录成功、退出登录、catalog refresh 后配置同步正确。

### D 轮：双跑验证与切默认

目标：

1. 在开发态或测试包中开启 native path。
2. 验证 managed agent 调用内置工具成功。
3. 验证工具列表变化后无需 gateway 硬重启。
4. 将默认路径切到 native managed MCP。

当前落地状态：

1. `QINGSHU_MANAGED_NATIVE_MCP` 默认开启。
2. 如需回退旧 bridge managed local tools 路径，可显式设置 `QINGSHU_MANAGED_NATIVE_MCP=0` 或 `QINGSHU_MANAGED_NATIVE_MCP=false`。
3. 默认开启时，旧 `McpServerManager` 不再注册 `qingshu-managed` local server，避免同一批青数 managed tools 同时从 bridge 与 native MCP 两条路径暴露。
4. 旧 bridge 仍保留，用于外部 MCP 旧路径和下一轮删除前的回退。

验收：

1. managed agent 能正常调用后端 managed tools。
2. 退出登录后 tools 不再暴露。
3. 登录后 tools 可恢复。
4. OpenClaw gateway 无 `/mcp/execute` 依赖。

### E 轮：删除旧 bridge execute 与 `McpServerManager`

目标：

1. 删除 `McpServerManager`。
2. 简化 `McpBridgeServer` 为 AskUser-only，与 `origin/main` 对齐。
3. 删除 `/mcp/execute`、bridge tool manifest、mcp-bridge plugin config 注入。
4. 清理 renderer bridge sync UI / IPC。

验收：

1. 与 `origin/main` 的 native MCP 主干形态一致。
2. 青数 managed tools 仍可用。
3. OpenClaw 原生 MCP、AskUser、青数治理链三者均通过验证。

## 7. 风险与保护措施

1. 认证态风险：managed tool invoke 依赖青数 access token，native MCP server 必须留在主进程内，不能把 token 下发给 OpenClaw。
2. 工具清单漂移：catalog refresh 后需要刷新 MCP server tools，并触发 OpenClaw config sync。
3. 安全风险：本地 HTTP endpoint 必须只绑定 `127.0.0.1`，并强制 secret header。
4. 兼容风险：切默认前必须保留旧 bridge 作为回退。
5. 命名风险：server name 继续使用 `qingshu-managed`，tool name 保持后端 `toolName`，避免 managed agent prompt/toolRefs 漂移。

## 8. 当前建议

当前 A-E 轮已经完成到代码收口阶段：

1. `QingShuManagedMcpServer` 已作为主进程内 Streamable HTTP MCP server 落地，OpenClaw 通过 `mcp.servers.qingshu-managed` 原生连接。
2. `QingShuManagedCatalogService` 只保留 native manifest 与 invoke wrapper，旧 `registerLocalToolRuntime(...)` 已删除。
3. `McpBridgeServer` 已简化为 AskUser-only，只保留 `/askuser` 回调，不再提供 `/mcp/execute`。
4. `McpServerManager`、`mcpLog` 及对应测试已删除，renderer/preload 的 `refreshBridge` 与 bridge sync UI / IPC 已清理。
5. 后续 main 分支 MCP 相关更新应按 `mcp.servers` 原生路径合入，不再恢复 bridge tool manifest 或 `/mcp/execute`。
