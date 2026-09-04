## ADDED Requirements

### Requirement: IR Surface endpoint 集合

web-channel SHALL 在 `/api/v1/ir` URL 前缀下提供一个 IR（machine-to-machine）surface。IR surface SHALL 恰好暴露以下 6 个 endpoint，镜像对应 ER endpoint 的协议、DTO、schema 和 stream 行为：

- `POST /api/v1/ir/sessions` — 创建 session
- `POST /api/v1/ir/sessions/:sessionId/requests` — 提交请求
- `GET /api/v1/ir/sessions/:sessionId/stream` — SSE stream 消费
- `POST /api/v1/ir/sessions/:sessionId/cancel` — 取消请求
- `POST /api/v1/ir/sessions/:sessionId/retry` — 重试最近请求
- `POST /api/v1/ir/sessions/:sessionId/pending-inputs/:pendingInputId/answer` — 回答 pending input

IR surface SHALL NOT 暴露任何其他 ER endpoint。`registerWebChannel` SHALL 接受一个 `routePrefix` 参数，并以 `${routePrefix}/...` 构造路由路径。ER 注册 SHALL 传入 `/api/v1`，IR 注册 SHALL 传入 `/api/v1/ir`，并带有一个只注册上述 6 个 endpoint 的路由白名单。

#### Scenario: IR endpoint 镜像 ER 协议
- **WHEN** 调用方以正确的 identity header 向 6 个 IR endpoint 中的任何一个发送有效请求
- **THEN** 响应 DTO、schema 校验、stream envelope 和 runtime 委托 MUST 与对应的 ER endpoint 完全一致
- **AND** 相对 ER 唯一可观察的差异 MUST 只是 URL 前缀

#### Scenario: IR surface 不暴露仅面向 UI 的 ER endpoint
- **WHEN** IR surface 被注册
- **THEN** 诸如 `/api/v1/ir/runtime/bootstrap`、`/api/v1/ir/skills`、`/api/v1/ir/frequent-questions`、`/api/v1/ir/sessions/:sessionId/conversation`、`/api/v1/ir/favorites` 和 `/api/v1/ir/shares` 之类的 endpoint MUST NOT 被注册
- **AND** 请求这些路径 MUST 返回 HTTP 404

#### Scenario: ER 注册不受 routePrefix 参数化影响
- **WHEN** ER 路由以设为 `/api/v1` 的 `routePrefix` 注册
- **THEN** 所有既有 ER endpoint 路径 MUST 保持不变
- **AND** 所有既有 ER 行为 MUST 保持一致

### Requirement: 来自可信 header 的 IR identity

IR surface 的 identity SHALL 从请求 header `x-tenant-id`、`x-subject-id` 和 `x-display-name` 派生，使用 task-channel 已在使用的同一个 `createTaskIdentityResolver`。`x-tenant-id` 和 `x-subject-id` SHALL 是必需的；`x-display-name` SHALL 是可选的，缺失时回退到一个已配置的默认值。

该 resolver SHALL 以可信 header 模式运行：上游 gateway 已完成认证并注入这些 header，NextAgent SHALL 直接读取它们而不执行自己的 credential 校验。请求体、query、metadata 和 model 输出 SHALL NOT 覆盖从 header 派生的 identity。

Agent scope SHALL NOT 从 header 派生。它 SHALL 来自 `requireSession` 返回的已持久化 `session.agentId`，与 ER 行为一致。

#### Scenario: 有效 header 产生可信 IdentityContext
- **WHEN** 一个到达 IR endpoint 的请求携带 `x-tenant-id` 和 `x-subject-id` header
- **THEN** resolver MUST 用这些值构造一个 `IdentityContext`
- **AND** 如果存在 `x-display-name`，它 MUST 被用作 `displayName`；否则 MUST 使用已配置的默认值

#### Scenario: 缺失必需 header 被拒绝
- **WHEN** 一个到达 IR endpoint 的请求省略了 `x-tenant-id` 或 `x-subject-id`
- **THEN** resolver MUST 抛出认证错误
- **AND** channel MUST 返回一个安全的 401 响应
- **AND** MUST NOT 创建 session、request run、message、attachment、pending input 或 capability 状态

#### Scenario: 请求体不能覆盖 header identity
- **WHEN** 一个到达 IR endpoint 的请求在 body 中包含 `tenantId`、`subjectId`、`agentId` 或其他 scope 字段
- **THEN** schema 校验 MUST 拒绝或忽略这些字段
- **AND** 来自 header 的可信 `IdentityContext` MUST 是唯一的 owner-scope 输入

#### Scenario: Agent scope 不来自 header
- **WHEN** 一个 IR 请求被处理
- **THEN** agent scope MUST 从已持久化 session 的 `agentId` 派生
- **AND** MUST NOT 从任何请求 header 派生

### Requirement: IR 与 ER 认证隔离

IR 路由 SHALL 只通过可信 header 认证；ER 路由 SHALL 只通过本地 cookie 认证。两条认证路径 SHALL NOT 交叉接受：带 cookie 但无 header 的请求 MUST 在 IR 路由上被拒绝，带 header 但无 cookie 的请求 MUST 在 ER 路由上被拒绝。

路由分类 SHALL 在任何 runtime 调用之前把每个请求导向其对应的认证闸门。任一路径上失败或缺失的 credential SHALL 产生一个安全的 401 响应，并 MUST NOT 产生任何持久副作用。

#### Scenario: 仅带 cookie 的请求在 IR 路由上被拒绝
- **WHEN** 一个到达 IR endpoint 的请求携带有效的 ER cookie 但没有 identity header
- **THEN** IR 认证闸门 MUST 以一个安全的 401 拒绝它
- **AND** MUST NOT 调用任何 runtime port

#### Scenario: 仅带 header 的请求在 ER 路由上被拒绝
- **WHEN** 一个到达 ER endpoint 的请求携带 identity header 但没有有效 cookie
- **THEN** ER 认证闸门 MUST 以一个安全的 401 或 challenge 拒绝它
- **AND** MUST NOT 调用任何 runtime port

#### Scenario: 认证失败不产生副作用
- **WHEN** 任何认证失败发生在 IR 或 ER 路由上
- **THEN** 系统 MUST NOT 创建或修改 session、RequestRun、message、attachment、memory、pending input、checkpoint、timeline 或 capability 状态

### Requirement: IR stream 消费

IR SSE endpoint `GET /api/v1/ir/sessions/:sessionId/stream` SHALL 在 replay、live-tail、terminal 投影、abort 和清理语义上与 ER stream endpoint 行为一致。它 SHALL 接受 `lastSeenSequence`、`requestId` 和 `runId` query 参数，其校验和默认行为与 ER 相同。

IR surface 上的 stream envelope SHALL 包含与 ER 相同的 canonical 字段。guardrail forward relay（当存在 guardrail binding 时）SHALL 对 IR stream 的应用方式与 ER stream 完全一致。

#### Scenario: IR stream 从 lastSeenSequence 开始 replay
- **WHEN** 调用方以一个有效的 `lastSeenSequence` 打开 IR stream
- **THEN** stream MUST replay sequence 大于该值的事件
- **AND** 然后继续输出 live 事件

#### Scenario: IR stream 校验 session scope
- **WHEN** 调用方为一个处于可信 Owner Scope 之外的 session 打开 IR stream
- **THEN** stream 建立 MUST 以一个安全的 not-found 响应失败
- **AND** MUST NOT 订阅 RuntimeSessionPort.streamEvents

### Requirement: IR 安全错误与容量边界

所有 IR endpoint SHALL 在每个不可信边界上使用 runtime schema 校验。安全错误、日志、metric、trace 和 audit 事实 SHALL NOT 包含 prompt、model 输出、stream delta、credential、token、raw 文件内容或不安全的 URL 细节。跨 owner 或跨 agent 的请求 SHALL 产生一个安全的 not-found 响应而不揭示存在性。

#### Scenario: 跨 scope 请求被隐藏
- **WHEN** 调用方访问一个属于另一个 owner 或 agent scope 的 session 的 IR endpoint
- **THEN** channel MUST 返回一个安全的 404 或等价的安全错误
- **AND** MUST NOT 揭示该 session 的存在

#### Scenario: 安全错误不泄露敏感数据
- **WHEN** 一个 IR 请求未通过校验、被 runtime 拒绝或被 guardrail 拦截
- **THEN** 安全错误响应 MUST NOT 包含 prompt、model 输出、credential、token、raw 文件内容或回调 body
