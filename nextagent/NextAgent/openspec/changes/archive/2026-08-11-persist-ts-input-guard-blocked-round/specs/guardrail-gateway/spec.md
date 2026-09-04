## MODIFIED Requirements

### Requirement: A blocked round is excluded from model-visible history in subsequent rounds

当一轮请求因输入或输出护栏被拦截而未产出 model-visible assistant 响应时，该轮的 assistant 响应内容 MUST NOT 作为 model-visible 历史消息持久化，也 MUST NOT 进入后续轮次的 model context。下一轮请求组装 model context 时 MUST NOT 包含被拦截轮次的 assistant 响应原文或其增量片段。

输入 BLOCKED 与 output-guard block 的持久化归属如下，二者均不进入 model context：

- 输入 BLOCKED：Web channel 的 submit 路径 MUST NOT 调用 `runtime.submit`，不创建 run、不产生 terminal timeline event。Web channel MUST 经 `RuntimeCommandPort.recordInputGuardBlock` 持久化一对 `SessionMessage`：用户输入消息（`role=USER`，content 为用户输入原文）与拒答消息（`role=ASSISTANT`，content 为 RobotRouter 透传的 `refusalMessage`，NextAgent MUST NOT 改写或生成）。两条消息 MUST 共享同一 `requestId`、MUST NOT 关联 `runId`，且 MUST 携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`。两条消息的 `visible` 字段 MUST 为 `true`，使 conversation 接口返回它们供页面渲染（页面可见）；`metadata.modelVisibility.excluded=true` 使 context assembly 排除它们（模型不可见）。该持久化 MUST 幂等：同一 `idempotencyKey` 重复触发 MUST NOT 复制消息对。Web channel 在持久化之后仍 MUST 以 HTTP 400 返回 `error.code="GUARD_INPUT_BLOCKED"`、`error.message` 为 `refusalMessage`，作为前端即时反馈；前端 MUST NOT 依赖本地伪造信封或 `sessionStorage` 镜像维持该轮可见性。
- output-guard block：run 仍按正常路径终态提交，assistant 终态消息以 `visible=false` 持久化（经 `TerminalCommitOptions.guardBlocked` + `RuntimeCommandPort.hideRunMessages`，`VisibilityReason="GUARD_BLOCKED"`），不进下一轮 model context。该路径不在本 change 修改范围。

输入拦截轮的 safe marker（用户输入与拒答消息）`visible=true` 但 `metadata.modelVisibility.excluded=true`：MUST 经 conversation 接口返回（因 `visible=true`，不被 `includeHidden=false` 过滤），使页面刷新、关闭重开、锚定视图与 older/newer 游标分页后该轮均按真实时序位置可见；MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容——context assembly 的 `isHiddenReplacement` MUST 在 `metadata.modelVisibility.excluded === true` 时返回 true，与 `visible` 字段无关。前端清空只作用于本轮已渲染内容，历史轮次展示不受影响。

`recordInputGuardBlock` 是 `RuntimeCommandPort` 的可选命令，与 `hideRunMessages` 对称：`hideRunMessages` 隐藏已有 run 的 assistant 消息，`recordInputGuardBlock` 记录无 run 的输入拦截轮。该 command 的 identity MUST 来自当前 trusted owner/Agent/session scope，MUST NOT 接受客户端 metadata 或被拦截输入中的 identity override。runtime 实现 MUST 经 `SessionMessageStoreGateway.appendSessionMessage` 写入，MUST NOT 新增 message role、stream event type、gateway port 或数据库表。`metadata.modelVisibility` 是 `SessionMessage.metadata` 的 additive typed extension（owner 为 `agent-contracts/session`），不影响现有 `visible`/`replacement`/`visibility` metadata 字段语义。

#### Scenario: Output-blocked round is hidden from next round model context

- **WHEN** 某轮因 output-guard block 被拦截（run 正常终态提交，assistant 终态消息 `visible=false`）
- **THEN** 该轮的 assistant 响应 MUST NOT 持久化为 model-visible 历史消息
- **AND** 下一轮组装 model context 时 MUST NOT 包含该轮 assistant 响应原文或增量片段

#### Scenario: Input-blocked round produces no model-visible assistant message

- **WHEN** 某轮因输入 BLOCKED 被拦截而未执行 Agent
- **THEN** 该轮 MUST NOT 产生 model-visible assistant 响应
- **AND** 后端持久化的拒答 safe marker（`visible=true` 但 `metadata.modelVisibility.excluded=true`）MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容
- **AND** 下一轮组装 model context 时 MUST NOT 包含该轮任何 assistant 内容

#### Scenario: Input-blocked round is displayed and survives page refresh

- **WHEN** 某轮因输入 BLOCKED 被拦截（不调用 `runtime.submit`）
- **THEN** 后端 MUST 经 `recordInputGuardBlock` 持久化 `visible=true` 的用户输入消息与拒答消息，且携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`
- **AND** conversation 接口 MUST 返回该轮消息对（因 `visible=true`，不被 `includeHidden=false` 过滤）
- **AND** 页面刷新、关闭重开、锚定视图与游标分页后该轮 MUST 仍按真实时序位置可见
- **AND** 前端 MUST NOT 依赖本地伪造信封或 `sessionStorage` 镜像维持该轮可见性
- **AND** 该 safe marker 因 `metadata.modelVisibility.excluded=true` MUST NOT 进入后续轮次的 model context

#### Scenario: Input-blocked round HTTP feedback remains unchanged

- **WHEN** 输入护栏拦截用户输入
- **THEN** Web channel MUST 以 HTTP 400 返回 `error.code="GUARD_INPUT_BLOCKED"`、`error.message` 为 RobotRouter 透传的 `refusalMessage`
- **AND** 前端 MUST 凭该 400 响应即时展示拒答，MUST NOT 等待 conversation 重建才显示
- **AND** 该 400 响应 MUST NOT 向客户端流注入新 stream event

#### Scenario: Input-blocked round persistence is idempotent

- **GIVEN** 同一 `idempotencyKey` 的输入拦截已持久化消息对
- **WHEN** `recordInputGuardBlock` 以同一 `idempotencyKey` 重复触发
- **THEN** runtime MUST NOT 复制用户输入消息或拒答消息
- **AND** conversation 接口 MUST 只返回一对该轮消息

#### Scenario: Blocked round safe marker is not model-visible

- **WHEN** 系统为被拦截轮次持久化 safe 标记用于审计或前端展示
- **THEN** 该标记 MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容

## Function 变更汇总

### 名称

- 变更类型：修改
- 目标内容：`guardrail-gateway` Function 的输入护栏拦截轮持久化归属从"前端侧持久化、后端不持久化"改为"后端持久化 `visible=true` + `metadata.modelVisibility.excluded=true` safe marker，经新增 `RuntimeCommandPort.recordInputGuardBlock` 写入；页面可见（conversation 返回）与模型不可见（context assembly 按 `modelVisibility.excluded` 排除）解耦"。
- 依据 Requirements：`A blocked round is excluded from model-visible history in subsequent rounds`。

### 处理过程

- 变更类型：修改
- 目标内容：输入 BLOCKED 时，Web channel 在抛 HTTP 400 `GUARD_INPUT_BLOCKED` 之前，经 `recordInputGuardBlock` 持久化 `visible=true` 的用户输入消息与拒答消息（携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`、共享 `requestId`、无 `runId`、幂等）；不调用 `runtime.submit`、不创建 run、不产生 terminal timeline event。conversation 接口因 `visible=true` 返回该消息对供前端重建；context assembly 因 `metadata.modelVisibility.excluded=true` 排除它不进 model context。
- 依据 Requirements：`A blocked round is excluded from model-visible history in subsequent rounds`。

### 接口

- 变更类型：修改
- 目标内容：`RuntimeCommandPort` 新增可选 `recordInputGuardBlock?(command: RecordInputGuardBlockCommand): Promise<void>`，与 `hideRunMessages` 对称；`RecordInputGuardBlockCommand` 携带 `identityContext`、`agentId`、`sessionId`、`inputText`、`refusalMessage`、`requestId`、`idempotencyKey`。复用现有 `SessionMessageRecord`、`VisibilityReason="GUARD_BLOCKED"`、`SessionMessageStoreGateway.appendSessionMessage`，不新增 message role、stream event type、gateway port 或数据库表。新增 `SessionMessage.metadata.modelVisibility`（`{ excluded: boolean, reason: VisibilityReason }`）additive typed extension，owner 为 `agent-contracts/session`，由 context assembly `isHiddenReplacement` 消费：`modelVisibility.excluded === true` 时排除该消息出 model context，与 `visible` 字段无关。
- 依据 Requirements：`A blocked round is excluded from model-visible history in subsequent rounds`。
