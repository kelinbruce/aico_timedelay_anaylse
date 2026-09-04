# request-cancel Specification Delta

## MODIFIED Requirements

### Requirement: Canceled run 终端 content 不得包含内部错误消息

Runtime MUST 在 cancel 终端提交时使用中性占位字符串或已流式的正文内容作为终端 content，MUST NOT 使用 `safeErrorContent`、`AgentError.message`、provider safe error message 或任何执行阶段特定的错误描述作为终端 content。该约束 MUST 对所有执行阶段（模型调用、capability 执行、routing、sandbox、lifecycle hook、memory 等）的 cancel 场景一致成立。

#### Scenario: 无流式正文时 cancel 终端 content 使用固定占位字符串

- **GIVEN** 一个 executing run 被 cancel 打断
- **AND** cancel 发生在模型 thinking 阶段或任何未产生 `LLM_CONTENT_DELTA` 事件的阶段
- **WHEN** Runtime 提交 cancel 终态
- **THEN** 终端 content MUST 为 `'Request canceled by user.'`
- **AND** 终端 content MUST NOT 包含 `safeErrorContent` 输出、error message 或 error code
- **AND** 终端 content MUST NOT 因 cancel 发生的执行阶段不同而变化

#### Scenario: 有流式正文时 cancel 终端 content 保留已生成内容

- **GIVEN** 一个 executing run 被 cancel 打断
- **AND** cancel 前已产生至少一个 `LLM_CONTENT_DELTA` 事件
- **WHEN** Runtime 提交 cancel 终态
- **THEN** 终端 content MUST 为已流式的 `finalContent`
- **AND** 终端 content MUST NOT 被 error message 覆盖

#### Scenario: cancel catch 路径与正常返回路径使用相同 fallback

- **GIVEN** cancel 通过 `controller.abort()` 触发，`agent.execute()` 抛出 error
- **WHEN** Runtime catch block 检测到 `executionState.canceling === true`
- **THEN** catch 路径的终端 content fallback MUST 与正常返回路径一致
- **AND** 两条路径都 MUST 使用 `finalContent ?? 'Request canceled by user.'`
- **AND** catch 路径 MUST NOT 使用 `safeErrorContent(terminalError)` 作为 fallback

#### Scenario: 不同执行阶段 cancel 产生相同终端 content

- **GIVEN** cancel 分别发生在模型调用、capability 执行、routing、sandbox、lifecycle hook 或 memory 阶段
- **AND** 各阶段产生不同的 `AgentError.code` 和 `AgentError.message`
- **WHEN** Runtime 提交 cancel 终态
- **THEN** 无流式正文时，终端 content MUST 统一为 `'Request canceled by user.'`
- **AND** 终端 content MUST NOT 反映具体被中断阶段的错误描述

## ADDED Requirements

### Requirement: Cancel 终端事件 requestContextId 与原始请求一致

Runtime MUST 在 cancel 终端提交时使用与原始请求相同的 `requestContextId`，MUST NOT 为 cancel 操作生成新的 `requestContextId`。该约束 MUST 对所有 cancel 路径（执行中 run 的 catch 路径和非执行中 run 的 `commitCanceledRun` 路径）一致成立。前端 conversation store 依赖 `requestContextId` 作为 `attemptId` 进行 bucket 匹配，`requestContextId` 不一致会导致终端事件被拒绝，run 状态无法收束。

#### Scenario: 非执行中 run cancel 终端事件使用原始 requestContextId

- **GIVEN** 一个 run 处于 pending input 或 queued 状态（不在 `executingRuns` 中）
- **AND** 该 run 的原始 `requestContextId` 为 `ctx-original`
- **WHEN** Runtime 通过 `commitCanceledRun` 提交 cancel 终态
- **THEN** `REQUEST_CANCELED` 终端事件的 `requestContextId` MUST 为 `ctx-original`
- **AND** MUST NOT 为 `toControlContext` 生成的新 ID（如 `context-cancel-xxx`）

#### Scenario: 执行中 run cancel 终端事件使用原始 requestContextId

- **GIVEN** 一个 run 正在执行（在 `executingRuns` 中）
- **AND** 该 run 的原始 `requestContextId` 为 `ctx-original`
- **WHEN** cancel 通过 `controller.abort()` 触发，catch 路径提交 cancel 终态
- **THEN** `REQUEST_CANCELED` 终端事件的 `requestContextId` MUST 为 `ctx-original`
- **AND** 两条 cancel 路径（catch 路径和 `commitCanceledRun` 路径）的 `requestContextId` MUST 一致

#### Scenario: 前端 conversation store 接受 terminal 事件 attemptId 不匹配

- **GIVEN** 前端 conversation store 中存在 `rootMessageId` 为 `req-1` 的 active bucket
- **AND** 该 bucket 的 `attemptId` 为 `ctx-original`
- **WHEN** 一个 terminal 事件到达，`rootMessageId` 为 `req-1` 但 `attemptId` 为 `ctx-other`
- **THEN** conversation store MUST 接受该 terminal 事件
- **AND** MUST 将 active bucket 移入 settled（标记为 terminal）
- **AND** MUST NOT 将该 terminal 事件放入 `rejectedEnvelopes`
