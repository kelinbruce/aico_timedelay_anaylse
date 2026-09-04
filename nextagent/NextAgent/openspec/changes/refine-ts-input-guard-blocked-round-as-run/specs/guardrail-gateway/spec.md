## MODIFIED Requirements

### Requirement: A blocked round is excluded from model-visible history in subsequent rounds

当一轮请求因输入或输出护栏被拦截而未产出 model-visible assistant 响应时，该轮的 assistant 响应内容 MUST NOT 作为 model-visible 历史消息持久化，也 MUST NOT 进入后续轮次的 model context。下一轮请求组装 model context 时 MUST NOT 包含被拦截轮次的 assistant 响应原文或其增量片段。

输入 BLOCKED 与 output-guard block 的持久化归属如下，二者均不进入 model context：

- 输入 BLOCKED：Web channel 的 submit 路径 MUST 调用 `runtime.submit`，在 `SubmitRequestCommand` 携带 `guardBlockRefusal`（RobotRouter 透传的 `refusalMessage`，NextAgent MUST NOT 改写或生成）。`runtime.submit` MUST 创建 run 并持久化用户输入消息（`role=USER`，content 为用户输入原文，`visible=true`），随后在 run 持久化之后、入队调模型之前 MUST 立即终态化为 `COMPLETED`：经 `commitTerminal` 写入拒答消息（`role=ASSISTANT`，content 为 `guardBlockRefusal`，`visible=true`），run 状态转为 `COMPLETED`、`terminalCommitState=COMMITTED`。`runtime.submit` MUST NOT 入队 `enqueueWork`、MUST NOT 调用模型、MUST NOT 产出 model invocation 事件。拒答消息与用户输入消息 MUST 共享同一 `requestId` 与 `runId`，且 MUST 携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }` 与 `metadata.guardReason = "INPUT_VIOLATION"`。两条消息的 `visible` 字段 MUST 为 `true`，使 conversation 接口返回它们供页面渲染（页面可见）；`metadata.modelVisibility.excluded=true` 使 context assembly 排除它们（模型不可见）。Web channel MUST 以正常 `RequestAccepted` 响应返回（HTTP 200），前端经 stream 收到 `REQUEST_ACCEPTED` → `REQUEST_COMPLETED` 事件，MUST NOT 以 HTTP 400 `GUARD_INPUT_BLOCKED` 返回；前端 MUST NOT 依赖本地伪造信封、`sessionStorage` 镜像或 `submitError` 维持该轮可见性。
- output-guard block：run 仍按正常路径终态提交，assistant 终态消息以 `visible=false` 持久化（经 `TerminalCommitOptions.guardBlocked` + `RuntimeCommandPort.hideRunMessages`，`VisibilityReason="GUARD_BLOCKED"`），不进下一轮 model context。该路径不在本 change 修改范围。

输入拦截轮的 safe marker（用户输入与拒答消息）`visible=true` 但 `metadata.modelVisibility.excluded=true`：MUST 经 conversation 接口返回（因 `visible=true`，不被 `includeHidden=false` 过滤），使页面刷新、关闭重开、锚定视图与 older/newer 游标分页后该轮均按真实时序位置可见；MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容——context assembly 的 `isHiddenReplacement` MUST 在 `metadata.modelVisibility.excluded === true` 时返回 true，与 `visible` 字段无关。

输入拦截轮 MUST 走正常 run 生命周期：run 进入 `requestRunStore`，`retryLatest`/`editLatest` MUST 能以其 `requestId`/`runId` 定位它（status=`COMPLETED`、`terminalCommitState=COMMITTED`，满足 retry 的终态前提），MUST NOT 为拦截轮写 retry/edit 特例。首条消息为拦截轮时，`runtime.submit` 的 `startSessionTitleGeneration` MUST 正常触发标题生成。`TerminalCommitOptions` 新增 `guardBlockedVisible` 选项（与 `guardBlocked` 互斥）：`guardBlockedVisible` 时 terminal message `visible=true` + `metadata.modelVisibility.excluded=true` + `guardReason=INPUT_VIOLATION`；`guardBlocked`（`visible=false`）语义不变，仅供 OUTPUT 护栏使用。本 change 删除 `RuntimeCommandPort.recordInputGuardBlock` 与 `RecordInputGuardBlockCommand`——拦截轮不再走"无 run 的二等公民"路径。`metadata.modelVisibility` 是 `SessionMessage.metadata` 的 additive typed extension（owner 为 `agent-contracts/session`），不影响现有 `visible`/`replacement`/`visibility` metadata 字段语义。

#### Scenario: Output-blocked round is hidden from next round model context

- **WHEN** 某轮因 output-guard block 被拦截（run 正常终态提交，assistant 终态消息 `visible=false`）
- **THEN** 该轮的 assistant 响应 MUST NOT 持久化为 model-visible 历史消息
- **AND** 下一轮组装 model context 时 MUST NOT 包含该轮 assistant 响应原文或增量片段

#### Scenario: Input-blocked round produces no model-visible assistant message

- **WHEN** 某轮因输入 BLOCKED 被拦截而未执行 Agent
- **THEN** 该轮 MUST NOT 调用模型、MUST NOT 产出 model invocation 事件
- **AND** 后端持久化的拒答 safe marker（`visible=true` 但 `metadata.modelVisibility.excluded=true`）MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容
- **AND** 下一轮组装 model context 时 MUST NOT 包含该轮任何 assistant 内容

#### Scenario: Input-blocked round is displayed and survives page refresh

- **WHEN** 某轮因输入 BLOCKED 被拦截（`runtime.submit` 创建 run 并立即 `COMPLETED` 终态，不调模型）
- **THEN** 后端 MUST 持久化 `visible=true` 的用户输入消息与拒答消息，且携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }` 与 `guardReason = "INPUT_VIOLATION"`
- **AND** conversation 接口 MUST 返回该轮消息对（因 `visible=true`，不被 `includeHidden=false` 过滤）
- **AND** 页面刷新、关闭重开、锚定视图与游标分页后该轮 MUST 仍按真实时序位置可见
- **AND** 前端 MUST NOT 依赖本地伪造信封、`sessionStorage` 镜像或 `submitError` 维持该轮可见性
- **AND** 该 safe marker 因 `metadata.modelVisibility.excluded=true` MUST NOT 进入后续轮次的 model context

#### Scenario: Input-blocked round is a normal run for retry/edit/title

- **WHEN** 某轮因输入 BLOCKED 被拦截（run status=`COMPLETED`、`terminalCommitState=COMMITTED`）
- **THEN** `retryLatest`/`editLatest` MUST 能以其 `requestId`/`runId` 定位该 run，MUST NOT 报 `REQUEST_RETRY_NOT_FOUND`
- **AND** retry MUST 恢复用户输入原文重新 submit，MUST NOT 退化为发送新消息
- **AND** 首条消息为拦截轮时，`startSessionTitleGeneration` MUST 正常触发并生成标题
- **AND** 前端 `handleRetryRequest` MUST 统一走 `retryLatest`，MUST NOT 为拦截轮写 `isGuardBlock` 特例

#### Scenario: Input-blocked round does not surface as a failure to the frontend

- **WHEN** 输入护栏拦截用户输入
- **THEN** Web channel MUST 以正常 `RequestAccepted` 响应返回（HTTP 200），MUST NOT 以 HTTP 400 `GUARD_INPUT_BLOCKED` 返回
- **AND** 前端经 stream 收到 `REQUEST_ACCEPTED` → `REQUEST_COMPLETED` 事件，MUST 走"完成"分支（`requestStatus` 非 `failed`）
- **AND** 拒答文案 MUST 作为 assistant 回复在会话列表正常显示，MUST NOT 显示在 composer 消息框（`composerInlineNotice` MUST NOT 含 `submitError`）

#### Scenario: Blocked round safe marker is not model-visible

- **WHEN** 系统为被拦截轮次持久化 safe 标记用于审计或前端展示
- **THEN** 该标记 MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容

#### Scenario: Input-blocked round HTTP feedback remains unchanged

- **WHEN** 输入护栏拦截用户输入
- **THEN** Web channel MUST 以 HTTP 200 的正常 `RequestAccepted` 响应返回
- **AND** 前端 MUST 经 stream 展示拒答，MUST NOT 依赖 HTTP 400 或本地伪造反馈
- **AND** 该响应 MUST 保持正常 request stream 生命周期

#### Scenario: Input-blocked round persistence is idempotent

- **GIVEN** 同一 `idempotencyKey` 的输入拦截 run 和消息对已持久化
- **WHEN** `runtime.submit` 以同一 `idempotencyKey` 和 `guardBlockRefusal` 重复触发
- **THEN** runtime MUST NOT 复制用户输入消息或拒答消息
- **AND** conversation 接口 MUST 只返回一对该轮消息

## Function 变更汇总

### 名称

- 变更类型：修改
- 目标内容：`guardrail-gateway` Function 的输入护栏拦截轮从"无 run 的二等公民 round（`recordInputGuardBlock`）"改为"走正常 `runtime.submit` 创建 run + 立即 `COMPLETED` 终态、不调模型、`modelVisibility.excluded` 排除"的一等公民 round。
- 依据 Requirements：`A blocked round is excluded from model-visible history in subsequent rounds`。

### 处理过程

- 变更类型：修改
- 目标内容：输入 BLOCKED 时，Web channel 调 `runtime.submit` 携带 `guardBlockRefusal`；`runtime.submit` 创建 run、持久化用户输入消息后，在入队调模型前立即 `commitTerminal('COMPLETED', ...)` 终态化（content 为拒答文案，terminal message `visible=true` + `modelVisibility.excluded=true` + `guardReason=INPUT_VIOLATION`），调 `startSessionTitleGeneration`，跳过 `enqueueWork` 不调模型。run 进入 `requestRunStore`，retry/edit/标题走正常路径。删除 `recordInputGuardBlock` 命令。
- 依据 Requirements：`A blocked round is excluded from model-visible history in subsequent rounds`。

### 接口

- 变更类型：修改
- 目标内容：`SubmitRequestCommand` 新增可选 `guardBlockRefusal?: string`；删除 `RuntimeCommandPort.recordInputGuardBlock?` 与 `RecordInputGuardBlockCommand`。`TerminalCommitOptions` 新增 `guardBlockedVisible?: { readonly refusalMessage: string }`（与 `guardBlocked` 互斥）：terminal message `visible=true` + `metadata.modelVisibility.excluded=true` + `guardReason=INPUT_VIOLATION`。复用现有 `SessionMessageRecord`、`RequestRunRecord`、`modelVisibility` extension、`SessionMessageStoreGateway`，不新增 message role、stream event type、gateway port、RunStatus 枚举值或数据库表。
- 依据 Requirements：`A blocked round is excluded from model-visible history in subsequent rounds`。
