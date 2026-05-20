# IM 多实例与 Agent 绑定机制

本文记录 QingShuClaw 当前 IM 多实例与 Agent 绑定的实际机制，重点说明“绑定后会发生什么”“是否互斥”“飞书等多实例平台如何路由到不同 Agent”，方便后续开发、验收和与 main 分支继续对齐。

## 一句话结论

Agent 中开启某个 IM 渠道绑定后，这个 IM 平台或实例收到的外部消息会进入被绑定的 Agent，而不是默认进入 `main` Agent。

如果没有任何绑定，则 IM 消息默认进入 `main` Agent。

同一个 IM 绑定 key 是互斥的：同一个飞书实例、钉钉实例、邮箱实例等只能归属一个 Agent。重新绑定到另一个 Agent，会由新的 Agent 接管后续会话。

## 配置真源

IM 到 Agent 的绑定配置保存在 `IMSettings.platformAgentBindings` 中。

字段位置：

```ts
export interface IMSettings {
  systemPrompt?: string;
  skillsEnabled: boolean;
  platformAgentBindings?: Record<string, string>;
}
```

配置含义：

- key 是 IM 平台或 IM 实例绑定 key。
- value 是目标 Agent ID。
- 没有配置或配置为 `main` 时，表示走默认主 Agent。

常见 key 形态：

```ts
{
  "feishu:feishu-instance-1": "sales-agent",
  "feishu:feishu-instance-2": "support-agent",
  "dingtalk:dingtalk-instance-1": "ops-agent",
  "email:sales-mailbox": "email-agent",
  "weixin": "main"
}
```

代码位置：

- [src/main/im/types.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/im/types.ts)
- [src/renderer/components/agent/AgentSettingsPanel.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/AgentSettingsPanel.tsx)
- [src/renderer/components/agent/AgentCreateModal.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/AgentCreateModal.tsx)
- [src/renderer/components/agent/agentImBindingConfig.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/agentImBindingConfig.ts)

## 支持多实例绑定的平台

当前多实例绑定识别的平台包括：

- `dingtalk`
- `discord`
- `feishu`
- `nim`
- `popo`
- `qq`
- `telegram`
- `wecom`
- `email`

其中 `weixin`、`netease-bee` 等仍可以按平台级绑定处理。

注意：是否在 UI 上展示某个平台，还会受地区可见性、平台配置是否存在、实例是否启用等条件影响。

## 路由优先级

IM 消息进入本地会话时，Agent 归属通过 `resolveAgentBinding()` 解析。

优先级如下：

1. 实例级绑定优先，例如 `feishu:bot-a -> sales-agent`。
2. 如果没有实例级绑定，再看平台级绑定，例如 `feishu -> support-agent`。
3. 如果都没有，回退到 `main`。

代码逻辑摘要：

```ts
if (MULTI_INSTANCE_PLATFORMS.has(platform) && accountId) {
  // 先找 platform:instanceId
}

return bindings[platform] || 'main';
```

代码位置：

- [src/main/libs/openclawChannelSessionSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawChannelSessionSync.ts)

## 飞书示例

### 场景 1：没有任何 Agent 绑定飞书

配置中没有：

```ts
{
  "feishu:xxx": "some-agent"
}
```

也没有：

```ts
{
  "feishu": "some-agent"
}
```

此时飞书来的消息默认进入 `main` Agent。

效果：

- 会话显示在主 Agent 下。
- 使用主 Agent 的工作目录、上下文和默认能力。
- 不会自动使用其他 Agent 的人设或 Skill。

### 场景 2：某个 Agent 绑定了飞书实例

配置示例：

```ts
{
  "feishu:bot-a": "sales-agent"
}
```

此时 `bot-a` 这个飞书实例来的消息会进入 `sales-agent`。

效果：

- 新会话归属 `sales-agent`。
- 使用 `sales-agent` 的 system prompt、identity、Skill、tool bundles、工作目录等。
- 这个飞书实例不再默认进入 `main`。

### 场景 3：多个飞书实例分别绑定不同 Agent

配置示例：

```ts
{
  "feishu:bot-sales": "sales-agent",
  "feishu:bot-support": "support-agent"
}
```

效果：

- `bot-sales` 的消息进入 `sales-agent`。
- `bot-support` 的消息进入 `support-agent`。
- 两个实例互不影响。

### 场景 4：平台级绑定作为兜底

配置示例：

```ts
{
  "feishu": "support-agent",
  "feishu:bot-sales": "sales-agent"
}
```

效果：

- `bot-sales` 命中实例级绑定，进入 `sales-agent`。
- 其他未单独绑定的飞书实例命中平台级绑定，进入 `support-agent`。

## 是否互斥

是，按绑定 key 互斥。

同一个 key 只能保存一个 Agent ID：

```ts
{
  "feishu:bot-sales": "sales-agent"
}
```

如果在另一个 Agent 中选择同一个飞书实例并保存，最终配置会变成：

```ts
{
  "feishu:bot-sales": "another-agent"
}
```

这意味着：

- `another-agent` 接管该飞书实例的后续消息。
- 原 `sales-agent` 不再接收该实例的新消息。
- 旧会话不会被删除，但后续路由会按新绑定执行。

代码位置：

- `buildAgentBindingKeyBindings()` 会清理同一 Agent 的旧绑定，并用当前选择写入新的 key。
- UI 中也会展示“已绑定到其他 Agent”的提示，提示用户这个实例已有归属。

相关文件：

- [src/renderer/components/agent/agentImBindingConfig.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/agentImBindingConfig.ts)
- [src/renderer/components/agent/AgentSettingsPanel.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/AgentSettingsPanel.tsx)
- [src/renderer/components/agent/AgentCreateModal.tsx](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/renderer/components/agent/AgentCreateModal.tsx)

## 绑定变更后的会话行为

绑定变更不会把历史 session 直接搬迁到新 Agent。

当前逻辑是：

1. 本地会记录 IM conversation 与 cowork session 的映射。
2. 当同一个 IM conversation 再次同步时，会重新解析当前绑定。
3. 如果发现映射里的旧 Agent 与当前绑定的 Agent 不一致，会为新 Agent 创建一个新的 cowork session。
4. 新 session 会标记为 Agent 变更产生的 session，避免把旧网关历史全量同步进新 session。

这样可以避免：

- 旧 Agent 的历史对话被硬搬到新 Agent。
- 新 Agent 被旧 Agent 的上下文污染。
- 同一个外部 IM 会话在绑定切换后继续错归属。

代码位置：

- [src/main/libs/openclawChannelSessionSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawChannelSessionSync.ts)

## OpenClaw 网关配置投影

保存 IM 绑定后，QingShuClaw 会把非 `main` 的显式绑定投影到 OpenClaw 配置中的 `bindings`。

规则：

- 只有非 `main` 绑定才写入 `openclaw.json`。
- 多实例平台会按实例写入精确匹配。
- 平台级绑定会写入 account wildcard，作为该平台的兜底匹配。
- 如果绑定的 Agent 不存在或未启用，不会写入网关配置。

示例：

```json
{
  "bindings": [
    {
      "agentId": "sales-agent",
      "match": {
        "channel": "feishu",
        "accountId": "feishu-i"
      }
    },
    {
      "agentId": "support-agent",
      "match": {
        "channel": "feishu",
        "accountId": "*"
      }
    }
  ]
}
```

代码位置：

- [src/main/libs/openclawConfigSync.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigSync.ts)
- [src/main/libs/openclawConfigSync.runtime.test.ts](/Users/wuyongsheng/workspace/projects/QingShuClaw/src/main/libs/openclawConfigSync.runtime.test.ts)

## Agent 设置里的交互效果

在 Agent 设置的“IM 渠道”中：

- 已配置且启用的实例可以被选择。
- 未配置或未启用的实例不会作为可绑定项生效。
- 选择某个实例后，保存会更新 `platformAgentBindings`。
- 如果该实例已经绑定到其他 Agent，界面会显示“已绑定到其他 Agent”的提示。
- 对青数 managed/readOnly Agent，IM 绑定属于外部路由配置，可以保存；不会修改青数内置 Agent 的品牌、人设、治理链等只读业务字段。

## 与 main Agent 的关系

`main` 是默认兜底 Agent，不是所有 IM 的固定归属。

规则：

- 没有绑定时，进入 `main`。
- 显式绑定到其他 Agent 后，进入其他 Agent。
- 显式绑定为 `main` 或删除绑定，本质上都是恢复默认行为。

因此，“绑定 IM 渠道”不是给 Agent 增加一个额外入口那么简单，而是在改变外部 IM 消息的归属路由。

## 验收建议

建议按以下场景验证：

1. 未绑定飞书实例时，从飞书发消息，确认会话出现在 `main` Agent。
2. 将飞书实例绑定到 Agent A 后，从飞书发新消息，确认会话出现在 Agent A。
3. 将同一个飞书实例改绑到 Agent B 后，再发消息，确认新会话出现在 Agent B，旧 Agent A 会话仍保留。
4. 配置两个飞书实例分别绑定 Agent A 和 Agent B，确认两个实例分别路由到不同 Agent。
5. 配置平台级 `feishu -> Agent C`，再配置实例级 `feishu:bot-a -> Agent A`，确认 `bot-a` 进入 Agent A，其他飞书实例进入 Agent C。
6. 删除绑定或绑定回 `main`，确认后续消息回到 `main` Agent。

## 开发注意事项

- 不要把“平台级绑定”和“实例级绑定”混为一个字段。实例级 key 应使用 `platform:instanceId`。
- 新增 IM 平台时，如果支持多实例，需要同时补：
  - UI 实例列表展示。
  - `agentImBindingConfig.ts` 中实例识别。
  - `openclawConfigSync.ts` 中 bindings 投影。
  - `openclawChannelSessionSync.ts` 中 accountId 解析和归属判断。
- 绑定变更后不要直接迁移旧 session 历史，优先创建新 Agent session，避免上下文污染。
- 对青数 managed Agent，IM 绑定是路由层配置，不应修改 managed descriptor、人设、内置治理链或品牌覆盖层。

