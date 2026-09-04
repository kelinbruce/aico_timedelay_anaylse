# local-runtime-recovery Delta Specification

所属 Function：`FN-11.1 恢复运行状态`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext

Runtime MUST 从 durable checkpoint、persisted messages、active context view、timeline facts 和 `RequestRun` metadata 重建 recovered `RequestContext`。Recovery MUST NOT 使用 stale process-local `RequestContext`、frontend transcript 或 model output buffer。checkpoint 与 recovered `RequestContext` MUST 携带相同的 `agentTurnIndex`，用于恢复同一 logical Agent turn；缺少必要 durable facts 时，Runtime MUST fail closed。

**需求类别**：功能性需求

#### Scenario: Recovery 从 persisted messages 重建 context

- **WHEN** recovery 继续 executing run
- **THEN** Runtime MUST 按 `sessionId`、`requestId`、`runId` 和 trusted scope 读取 persisted messages
- **AND** Runtime MUST 使用 active context view 或 durable context facts 选择 model-visible history
- **AND** Runtime MUST NOT 使用 frontend-rendered conversation 作为 recovered model context

#### Scenario: RequestContext 携带最小 Agent turn 恢复坐标

- **WHEN** Runtime 构造新接受或恢复执行的 `RequestContext`
- **THEN** `RequestContext` MUST 包含 session、`requestId`、run、identity、locale、agent id/version、assembly ref、next lifecycle stage、tool batch state、flow variables 和 `agentTurnIndex`
- **AND** 新接受的 run MUST 使用 `agentTurnIndex=0`
- **AND** recovered `RequestContext.agentTurnIndex` MUST 等于已校验 checkpoint 中的值
- **AND** `RequestContext` MUST NOT 包含 `attempt`、`deadlineAt` 或 `messageRefs`

#### Scenario: 当前 request 消息通过专用查询读取

- **WHEN** Runtime 为同一 request/run 重建 current-run message、Tool use 或 Capability result state
- **THEN** Runtime MUST 调用 `SessionMessageStoreGateway.listCurrentRequestMessages(CurrentRequestConversationRecordQuery)`
- **AND** query MUST 携带 trusted owner scope、Agent Scope、`sessionId`、`rootMessageId` 和 `runId`
- **AND** query result MUST 排除其他 request、run、owner 或 Agent 的 messages
- **AND** current-run Tool state reconstruction MUST NOT 重新解析 raw model output

#### Scenario: Checkpoint 约束 recovered execution

- **WHEN** durable checkpoint 存在
- **THEN** recovery MUST 使用 checkpoint 的 run/version/sequence/trigger/lifecycle stage 和 Agent turn coordinate 约束恢复点
- **AND** Runtime MUST 验证 checkpoint 与 `RequestRun`、timeline 和 message facts 一致
- **AND** 不一致 MUST 进入 safe recovery failure path

#### Scenario: Pending tool 需要 durable checkpoint

- **WHEN** executing recovery 需要恢复到 pending tool/capability boundary
- **THEN** Runtime MUST 依赖 durable checkpoint 和 assistant tool-use/capability-result messages 重建 pending tool state
- **AND** Runtime MUST NOT 仅凭模型输出 buffer 或 process-local tool state 重放 tool
- **AND** pending tool replay safety MUST 委托 runtime-recovery-idempotency-guard capability 的规则

#### Scenario: Recovery 保持 logical Agent turn 坐标

- **GIVEN** executing run 已开始一个普通 logical Agent turn 或已进入 finalizing turn
- **WHEN** Runtime 从 durable checkpoint 恢复该 run
- **THEN** recovered `RequestContext.agentTurnIndex` 和 execution MUST 复用 checkpoint 中同一个 `agentTurnIndex`
- **AND** MUST NOT 因 recovery 增加普通 turn 计数
- **AND** `agentTurnIndex=maxTurns` MUST 继续表示唯一 finalizing turn，MUST NOT 恢复为普通 turn 或开始第二个 finalizing turn

## ADDED Requirements

### Requirement: 检查点记录最小 Agent turn 恢复坐标

Runtime 保存的 checkpoint payload MUST 包含 `checkpointId`、`sessionId`、`requestId`、`runId`、`requestContextId`、`runVersion`、`triggerReason`、`lastSequence`、`activeContextVersion`、`flowVariables`、`agentTurnIndex` 和 `savedAt`。保存时的 `RequestContext.agentTurnIndex` MUST 原样写入 checkpoint。`agentTurnIndex` MUST 为非负安全整数，并 MUST 不大于 accepted assembly 的 effective `maxTurns`；`0..maxTurns-1` 表示普通 logical turns，`maxTurns` 表示唯一 finalizing turn。checkpoint write MUST 包含 `idempotencyKey`，并 MUST 使用 `sessionId`、`requestId` 和 `runId` 作为 run-level lookup anchor。

`triggerReason` MUST 使用 canonical closed vocabulary。checkpoint MUST NOT 持久化完整 tool call state 或 message refs；recovery MUST 使用 checkpoint 的 run version、trigger、sequence、active context version 和 Agent turn coordinate 校验恢复点，再从相同 scope 的持久化 messages 重建 pending Tool state。

`agentTurnIndex` 只标识 logical Agent turn，MUST NOT 替代 `nextLifecycleStage`、`currentToolBatchMessageId` 或 `toolCallStates`。恢复到 `BEFORE_CAPABILITY_INVOKE` 时，Runtime MUST 按 canonical pending Tool replay guard 继续该 turn，MUST NOT 因读取同一个 `agentTurnIndex` 重新调用已完成的 model boundary。

**需求类别**：功能性需求

#### Scenario: 模型调用前保存 Agent turn 坐标

- **WHEN** Runtime 保存允许 model invocation 开始的 checkpoint
- **THEN** checkpoint MUST 记录本次 logical turn 的 `agentTurnIndex`
- **AND** provider retry 或 recovery replay MUST 复用同一个 coordinate
- **AND** 开始下一 logical turn 前 MUST 先产生下一 coordinate 对应的 durable checkpoint

#### Scenario: Turn checkpoint 幂等键不阻止坐标推进

- **GIVEN** 同一个 run version 会保存多个 `STEP_STARTED` checkpoint
- **WHEN** logical Agent turn 从 index `n` 推进到 `n+1`
- **THEN** checkpoint write idempotency semantic MUST 区分两个 `agentTurnIndex`
- **AND** 重放同一个 run、trigger、run version 和 `agentTurnIndex` 的 save MUST 返回首次结果且不得重复 side effect
- **AND** 下一 turn 的 save MUST 产生包含 `n+1` 的新 checkpoint，不得错误返回 index `n` 的锚点事实

#### Scenario: Checkpoint 使用 run-level lookup anchor

- **WHEN** Runtime 加载 checkpoint 用于恢复
- **THEN** lookup request MUST 包含 `sessionId`、`requestId` 和 `runId`
- **AND** `runId` MUST NOT 为 optional
- **AND** gateway MUST NOT 使用 latest-checkpoint lookup semantics 代替 run-level anchor

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：恢复执行除重建 context 与 pending Tool state 外，还保持 `RequestRun` 的 logical Agent turn 坐标。
- 依据 Requirements：`Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`

### 输入

- 变更类型：修改
- 目标内容：checkpoint 与持久化 messages 共同提供 canonical recovery anchors 和唯一 run-level logical Agent turn coordinate；turn kind 由该坐标与 accepted `maxTurns` 的关系推导。
- 依据 Requirements：`Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`、`检查点记录最小 Agent turn 恢复坐标`

### 输出

- 变更类型：修改
- 目标内容：recovered `RequestContext.agentTurnIndex` 继续 checkpoint 指定的同一 logical turn；只有当前 turn 已闭合时才由 Agent Core推进到下一 coordinate。
- 依据 Requirements：`Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`

### 处理过程

- 变更类型：修改
- 目标内容：Runtime 在恢复前校验 turn coordinate 与 run、checkpoint、timeline 和 message facts 一致，不一致时 fail closed。
- 依据 Requirements：`Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`

### 结果

- 变更类型：修改
- 目标内容：pause、resume 和 crash recovery 不会重置 `maxTurns`，也不会产生第二个 finalizing turn。
- 依据 Requirements：`Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`

### 规格

- 规格项：Agent 轮次恢复连续性
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：同一 `RequestRun` 恢复后继续原 logical Agent turn coordinate；已进入 finalizing 的 run 不回到普通 turn，finalizing turn 最多一次
- 依据 Requirements：`Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`
