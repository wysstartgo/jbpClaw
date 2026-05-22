# QingShuClaw 登录与授权管理逻辑梳理

## 1. 文档目标

本文用于梳理 `QingShuClaw` 与 `qtb-data-platform` 当前已经对齐的登录、认证、授权与双向免登逻辑，重点回答以下问题：

- 登录和授权是否属于同一套用户体系
- 权限是否属于同一套权限体系
- 账密登录、飞书登录分别如何落地
- `QingShuClaw -> 青数 Web` 与 `青数 Web -> QingShuClaw` 如何免登
- 当前 token、桥接票据、刷新与退出逻辑分别承担什么职责
- 几种登录方式分别如何跳转、如何回到最终登录态

截至当前实现，系统已经统一到“平台用户 + 平台权限 + 目标侧会话桥接”的模式。

## 2. 统一口径

### 2.1 用户体系

统一身份口径为 `qtb-data-platform` 的平台用户。

这意味着：

- `QingShuClaw` 不维护独立账号域
- 无论用户从桌面端登录还是从 Web 登录，最终都映射到平台用户
- 桥接票据绑定的也是平台用户，而不是单独的“桌面端账号”

### 2.2 权限体系

统一权限口径为 `qtb-data-platform` 平台已有权限体系。

这意味着：

- Web 侧继续使用已有当前用户和权限接口
- `QingShuClaw` 专用接口继续通过后端 `UserHolder.findUser(...)` 识别当前用户
- 桌面端访问额度、头像、模型和代理模型时，本质仍由平台用户身份驱动

当前并没有为 `QingShuClaw` 再单独新建第二套权限表或权限服务。

## 3. 当前涉及的三类会话

### 3.1 Web 平台登录态

适用于青数 Web 正常页面访问。

特征：

- Web token 最终写入 `localStorage[SUPERSONIC_TOKEN]`
- request 拦截器自动附加 `Authorization` 与 `auth` 头
- 不依赖 cookie

主要用途：

- 登录青数 Web
- 获取当前用户和 RBAC 权限
- 访问 Web 页面与平台接口

### 3.2 QingShuClaw 桌面端登录态

适用于 `QingShuClaw` 客户端。

特征：

- 客户端主进程本地保存 `accessToken + refreshToken`
- 登录后会拉取：
  - 当前用户
  - 套餐/额度
  - 头像摘要
  - 可用模型
- 服务器模型调用走 `QingShuClaw` 专用接口

主要用途：

- 驱动客户端登录态恢复
- 驱动客户端模型列表和代理调用
- 驱动客户端头像、额度、套餐展示
- 驱动桌面端免登跳转与刷新续期

### 3.3 桥接票据

适用于跨端免登，不直接作为业务访问 token 使用。

特征：

- 一次性
- 短时有效
- 只负责“安全地把当前登录用户的会话切换到目标端”
- 票据本身不承担业务接口访问职责

主要用途：

- `QingShuClaw -> 青数 Web` 免登
- `青数 Web -> QingShuClaw` 免登

## 4. 账密登录逻辑

### 4.1 QingShuClaw 账密登录

客户端账密登录当前走桌面专用接口：

- `POST /api/qingshu-claw/auth/password-login`

流程如下：

1. 用户在客户端输入用户名和密码
2. 客户端按 Web 现有规则对密码进行 AES ECB 加密
3. 客户端调用主进程认证适配层
4. 后端直接校验平台账号密码，并按桌面端口径签发：
   - `accessToken`
   - `refreshToken`
5. 主进程将双 token 落到本地 `auth_tokens`
6. renderer 拉取当前用户、额度、头像摘要、模型列表
7. 客户端进入登录态

跳转特征：

- 无页面跳转
- 无 deep link
- 无浏览器参与
- 属于“桌面内闭环登录”

这条链路的本质是：

- 登录入口在桌面端
- 身份源头仍然是平台用户
- 会话类型已经拉齐到“桌面双 token 会话”

### 4.2 青数 Web 账密登录

Web 端账密登录同样走：

- `POST /api/auth/user/login`

流程如下：

1. 登录页提交用户名和加密后的密码
2. 后端返回平台 token
3. Web 将 token 写入 `localStorage[SUPERSONIC_TOKEN]`
4. Web 拉取当前用户和权限
5. Web 跳转首页

因此桌面端账密登录与 Web 账密登录，在“用户身份来源”上本身就是同一套平台逻辑。

## 5. 飞书登录逻辑

### 5.1 QingShuClaw 飞书登录

客户端飞书登录当前统一走扫码会话链路：

- 创建扫码会话：`POST /api/datachat/qingshu/auth/scan/session`
- 轮询状态：`GET /api/datachat/qingshu/auth/scan/session/{scanSessionId}`

当前桌面端有两种入口，但都汇聚到同一条扫码状态机。

#### 5.1.1 默认扫码登录

这是当前登录面板默认模式。

流程如下：

1. 客户端向后端申请一轮扫码会话
2. 后端返回 `authorizeUrl`、二维码内容和会话 ID
3. `QingShuClaw` 登录面板直接展示二维码
4. 客户端在本地持续轮询扫码会话状态
5. 用户在飞书完成扫码与确认
6. 后端在绑定完成后返回桌面端 `accessToken + refreshToken`
7. 客户端落库并刷新用户、额度、头像、模型

跳转特征：

- 无浏览器跳转
- 无 deep link
- 用户停留在 `QingShuClaw` 登录面板内完成

#### 5.1.2 手动模式下的“打开扫码页”

这是当前手动登录模式里的飞书入口。

流程如下：

1. 客户端先申请一轮扫码会话
2. 客户端打开应用内授权弹窗
3. 弹窗加载青数 Web 的：
   - `/login/desktop-scan?scanSessionId=...`
4. 该页面在弹窗内渲染飞书二维码，并继续查询同一个 `scanSessionId`
5. 桌面主界面自身也持有该 `scanSessionId`，保持等待与轮询态
6. 用户在飞书确认后，后端返回桌面端 `accessToken + refreshToken`
7. 客户端落库并进入登录态

跳转特征：

- 不走系统浏览器
- 不走旧的 `/api/auth/feishu/authorize -> /callback/router` 授权回跳链路
- 属于“应用内扫码页承载 + 同一扫码会话轮询”

这条链路中虽然 token 结构会比普通 Web token 多一些青数主体上下文，但后端识别用户时仍可统一回到平台用户。

### 5.2 青数 Web 飞书登录

Web 侧飞书登录走已有网页登录回调逻辑：

- 登录回调页拿 `code`
- 调飞书登录接口换取平台 token
- 将 token 写入 `SUPERSONIC_TOKEN`
- 拉当前用户与权限

跳转特征：

1. Web 登录页跳转飞书授权页
2. 飞书回调回到 Web 登录回调页
3. Web 自己完成 token 落地和页面跳转

因此桌面端飞书登录和 Web 飞书登录虽然入口不同，但最终都汇聚到同一平台用户。

## 6. QingShuClaw 专用后端接口

为了让桌面端保持与 Web 解耦，但仍使用同一平台身份，后端新增了 `QingShuClaw` 专用能力层。

当前核心接口包括：

- `GET /api/qingshu-claw/auth/quota`
- `GET /api/qingshu-claw/auth/profile-summary`
- `GET /api/qingshu-claw/models/available`
- `POST /api/qingshu-claw/proxy/v1/chat/completions`
- `POST /api/qingshu-claw/proxy/v1/images/generations`
- `POST /api/qingshu-claw/proxy/v1/images/edits`

这些接口的共同特征：

- 都由平台用户身份驱动
- 都通过已有平台鉴权识别当前用户
- 桌面端不直接复刻 Web 端业务页面，而是消费适配后的摘要接口

### 6.1 青数后台 Base URL 真源

`QingShuClaw` 中青数后台地址的唯一真源是客户端配置 `config.auth.qtbApiBaseUrl`，默认值定义在 `src/common/auth.ts` 的 `DEFAULT_QTB_API_BASE_URL`。

这一路径同时影响：

- 登录、刷新、用户资料、额度查询
- 青数内置模型列表：`/api/qingshu-claw/models/available`
- 青数内置模型调用：`/api/qingshu-claw/proxy/v1/chat/completions`
- 青数图片生成/编辑代理：`/api/qingshu-claw/proxy/v1/images/generations`、`/api/qingshu-claw/proxy/v1/images/edits`
- SkillHub managed catalog、managed tool、managed skill 包下载

OpenClaw 配置里的 `models.providers.qingshu-server.baseUrl` 不是远端青数后台地址，而是 `QingShuClaw` 主进程启动的本机 token proxy，例如 `http://127.0.0.1:<port>/v1`。它由 `src/main/libs/openclawConfigSync.ts` 自动生成，`qingshu-image` 等 Skill 会优先使用环境变量 `QINGSHU_IMAGE_PROXY_BASE_URL`，缺失时从 `openclaw.json` 读取这个本机代理地址。

因此切换测试、预发、生产环境时，应修改设置页“青数后台 API 地址”（即 `config.auth.qtbApiBaseUrl`），不要手动修改 `openclaw.json` 里的 `qingshu-server.baseUrl`。手动修改 `qingshu-server.baseUrl` 只会绕过本机 token proxy，导致登录态、套餐计量、图片代理和 SkillHub 能力不一致，并且下一次 OpenClaw 配置同步时也会被覆盖。

## 7. 双向免登方案

### 7.1 总体思路

双向免登不直接通过 URL 传业务 token，而是通过“桥接票据”完成目标端会话建立。

这样做的原因：

- 避免 URL 裸 token
- 避免把桌面端 token 与 Web token 强行混用
- 允许后端按目标端重新签发更合适的会话 payload

### 7.2 桥接票据模型

桥接票据当前为 DB-backed one-time ticket。

核心字段包括：

- `codeHash`
- `source`
- `target`
- `userId`
- `userName`
- `subjectContextJson`
- `redirectPath`
- `status`
- `expiresAt`
- `consumedAt`
- `createdAt`

规则如下：

- 原始 `code` 为高熵随机串
- DB 中只落 `codeHash`
- 票据短时有效
- 票据只能消费一次
- 过期票据和重复消费票据都会失败

## 8. QingShuClaw -> 青数 Web 免登

### 8.1 入口

客户端登录后，点击用户区域可触发“打开青数”的动作。

### 8.2 流程

1. `QingShuClaw` 调后端创建桥接票据：
   - `POST /api/qingshu-claw/auth/bridge/tickets`
   - 入参：`target=web`
2. 后端识别当前平台用户，生成一次性桥接票据
3. 客户端打开系统浏览器，进入：
   - `/login/bridge?code=...`
4. 青数 Web 的桥接页调用：
   - `POST /api/qingshu-claw/auth/bridge/exchange`
   - 入参：`target=web`
5. 后端按 Web 目标端重新签发 Web token
6. Web 将 token 写入 `localStorage[SUPERSONIC_TOKEN]`
7. Web 拉取当前用户与权限
8. Web 跳转目标页面

### 8.3 结果

用户在客户端点击后，可以无感进入已登录的青数 Web。

## 9. 青数 Web -> QingShuClaw 免登

### 9.1 入口

青数 Web 右上角头像菜单新增：

- `打开 QingShuClaw`

### 9.2 流程

1. Web 调后端创建桥接票据：
   - `POST /api/qingshu-claw/auth/bridge/tickets`
   - 入参：`target=desktop`
2. 后端识别当前平台用户，生成一次性桥接票据
3. Web 跳转：
   - `lobsterai://auth/bridge?code=...`
4. `QingShuClaw` 主进程接收 deep link
5. 客户端调用：
   - `POST /api/qingshu-claw/auth/bridge/exchange`
   - 入参：`target=desktop`
6. 后端按桌面端目标重新签发：
   - `accessToken`
   - `refreshToken`
7. 客户端落库并刷新：
   - 用户信息
   - 套餐/额度
   - 头像摘要
   - 模型列表

### 9.3 结果

用户在 Web 里点击后，可以无感进入已登录的 `QingShuClaw`。

## 10. Deep Link 处理

桌面端当前继续复用：

- `lobsterai://`

其中认证相关分为两类：

- `lobsterai://auth/callback`
  - 主要用于原有 OAuth 回调
- `lobsterai://auth/bridge`
  - 主要用于 Web -> Desktop 桥接免登

主进程收到 bridge code 后：

1. 先缓存在主进程，等待 renderer 可用
2. renderer 初始化后再消费
3. 执行换票并进入登录态恢复流程

## 11. 登录态生命周期与清理逻辑

### 11.1 本地登录态的唯一真相

当前桌面端的登录态唯一持久化真相是主进程 kv store 中的：

- `auth_tokens`

其中保存：

- `accessToken`
- `refreshToken`

renderer 不单独持久化业务 token，只消费主进程 auth IPC 提供的结果。

### 11.2 手动退出规则

手动退出当前已经统一为“全清”。

退出时会清理：

- 主进程本地 `auth_tokens`
- pending auth callback
- pending bridge code
- 授权弹窗
- renderer 登录态
- renderer 服务端模型列表
- 飞书扫码 session 缓存

这意味着：

- 手动退出后，下次启动不会再拿旧 `refreshToken` 续期
- 用户必须重新登录

### 11.3 登录失效规则

当前桌面端登录失效规则为：

1. 业务请求优先使用当前 `accessToken`
2. 若鉴权失效，先尝试 refresh
3. 若 refresh 成功：
   - 更新本地 `accessToken + refreshToken`
   - 继续当前会话
4. 若 refresh 失败：
   - 触发统一 `sessionInvalidated`
   - 执行与手动退出同等级别的全清
   - 用户必须重新登录

这条规则当前已经与手动退出口径拉齐：

- 手动退出：直接全清
- 登录失效：先 refresh，refresh 失败再全清

### 11.4 当前刷新策略

Web 侧：

- 仍由 Web 自己的登录态模型负责

桌面端：

- 优先尝试桌面桥接 token 的 refresh
- 兼容已有青数扫码 token 的 refresh
- 成功后更新本地 `accessToken + refreshToken`
- 失败后统一走本地会话失效全清

### 11.5 无 token 时的能力边界

没有有效登录 token 时，以下青数专属能力不可用：

- 当前用户信息
- 套餐/额度
- 头像摘要
- 服务端可用模型
- `lobsterai-server` / `QingShuClaw` 服务端代理模型调用
- 双向免登 bridge ticket 创建

但以下能力不受影响：

- 本地自定义 provider
- 本地 API Key 直连模型
- 不依赖平台登录态的本地 Cowork 配置与工作区能力

## 12. 为什么没有强制统一所有 token claims

第一阶段目标是统一：

- 用户语义
- 权限语义
- 双向免登能力

不是第一阶段就把 Web token、扫码 token、桌面桥接 token 的 claims 结构完全合并。

这样做的好处是：

- 复用现有系统，改动更小
- 不破坏 Web 现有登录链路
- 不破坏桌面端现有套餐/模型/头像链路

## 13. 安全边界

当前方案的安全边界如下：

- 不通过 URL 直接传业务 token
- 桥接票据只短时有效
- 桥接票据只允许消费一次
- 后端在换票时按目标端重新签发会话
- 客户端和 Web 只处理本端会话落地，不自行拼装业务 token

当前 v1 暂未做的增强项包括：

- 不绑定 IP / UA
- 不做多端联动登出
- 不做 bridge ticket 管理后台
- 不做跨环境桥接

## 14. 关键接口清单

### 14.1 平台登录接口

- `POST /api/auth/user/login`
- `GET /api/auth/user/getCurrentUser`
- `GET /api/rbac/user/permissions`

### 14.2 飞书相关接口

- `GET /api/auth/feishu/authorize`
- `POST /api/auth/feishu/login`
- `POST /api/datachat/qingshu/auth/scan/session`
- `GET /api/datachat/qingshu/auth/scan/session/{scanSessionId}`

### 14.3 QingShuClaw 专用接口

- `POST /api/qingshu-claw/auth/password-login`
- `GET /api/qingshu-claw/auth/quota`
- `GET /api/qingshu-claw/auth/profile-summary`
- `GET /api/qingshu-claw/models/available`
- `POST /api/qingshu-claw/proxy/v1/chat/completions`
- `POST /api/qingshu-claw/proxy/v1/images/generations`
- `POST /api/qingshu-claw/proxy/v1/images/edits`

### 14.4 桥接免登接口

- `POST /api/qingshu-claw/auth/bridge/tickets`
- `POST /api/qingshu-claw/auth/bridge/exchange`
- `POST /api/qingshu-claw/auth/bridge/refresh`

## 15. 当前实现中的关键代码位置

### 15.1 QingShuClaw

- 协议与 deep link 分发：
  - `src/main/main.ts`
- 客户端认证适配：
  - `src/main/auth/adapter.ts`
- preload 暴露 auth bridge IPC：
  - `src/main/preload.ts`
- renderer 登录态恢复：
  - `src/renderer/services/auth.ts`
- 用户菜单与打开青数动作：
  - `src/renderer/components/LoginButton.tsx`

### 15.2 qtb-data-platform

- 桥接票据与换票控制器：
  - `auth/authentication/.../QingShuClawController.java`
- 桥接票据核心服务：
  - `auth/authentication/.../QingShuBridgeAuthService.java`
- QingShuClaw 专用额度/头像/模型服务：
  - `auth/authentication/.../QingShuClawService.java`
- Web 头像菜单入口：
  - `webapp/packages/supersonic-fe/src/components/RightContent/AvatarDropdown.tsx`
- Web bridge 登录页：
  - `webapp/packages/supersonic-fe/src/pages/Login/Bridge.tsx`

## 16. 登录跳转流程总览

### 16.1 QingShuClaw 账密登录

`QingShuClaw 登录面板 -> 输入账密 -> auth:loginWithPassword -> /api/qingshu-claw/auth/password-login -> 落本地双 token -> 拉用户/额度/头像/模型 -> 进入登录态`

### 16.2 QingShuClaw 默认飞书扫码登录

`QingShuClaw 登录面板 -> 自动创建 scan session -> 面板展示二维码 -> 飞书扫码确认 -> 轮询 scan session -> 返回桌面双 token -> 进入登录态`

### 16.3 QingShuClaw 手动模式“打开扫码页”

`QingShuClaw 手动登录 -> 打开扫码页 -> 应用内弹窗加载 /login/desktop-scan?scanSessionId=... -> 飞书扫码确认 -> 轮询同一 scan session -> 返回桌面双 token -> 进入登录态`

### 16.4 青数 Web 账密登录

`Web 登录页 -> 提交账密 -> /api/auth/user/login -> 写入 SUPERSONIC_TOKEN -> 拉当前用户/权限 -> 跳首页`

### 16.5 青数 Web 飞书登录

`Web 登录页 -> 跳飞书授权页 -> 飞书回调 -> Web Callback 页 -> /api/auth/feishu/login -> 写入 SUPERSONIC_TOKEN -> 拉当前用户/权限 -> 跳首页`

### 16.6 QingShuClaw -> 青数 Web 免登

`QingShuClaw 用户菜单 -> 创建 target=web bridge ticket -> 打开 /login/bridge?code=... -> Web exchange -> 写 Web token -> 跳目标页`

### 16.7 青数 Web -> QingShuClaw 免登

`Web 头像菜单 -> 创建 target=desktop bridge ticket -> 跳 lobsterai://auth/bridge?code=... -> 桌面端 exchange -> 落本地双 token -> 拉用户/额度/头像/模型 -> 进入登录态`

## 17. 联调建议

建议至少验证以下场景：

- 桌面端账密登录后，点击“打开青数”，Web 直接进入登录态
- 桌面端飞书登录后，点击“打开青数”，Web 直接进入登录态
- Web 账密登录后，从头像菜单打开 `QingShuClaw`，客户端直接进入登录态
- Web 飞书登录后，从头像菜单打开 `QingShuClaw`，客户端直接进入登录态
- 重复消费同一个 bridge code 时，应明确失败
- bridge code 过期后，应明确失败
- 桥接失败时，不应误清空现有本地登录态
- 桌面端桥接登录后，额度刷新、头像展示、模型列表与模型对话正常
- 手动退出后，重启客户端不应自动恢复旧登录态
- 登录失效后，refresh 成功应保持登录态；refresh 失败应全清并要求重登

## 18. 总结

当前这套登录与授权管理逻辑，本质上已经实现了：

- 同一套平台用户体系
- 同一套平台权限体系
- 桌面端与 Web 双向免登
- 桌面端对套餐、额度、头像、模型和服务端代理的完整消费链路
- 手动退出全清
- 登录失效先 refresh，refresh 失败再全清

设计上采用的是“统一身份语义 + 目标端会话桥接”，而不是“一开始就完全统一所有 token 结构”。  
这符合当前项目阶段的 `KISS / YAGNI` 原则，也为后续继续收敛 token 语义、补多端联动能力留出了空间。
