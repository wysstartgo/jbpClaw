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
