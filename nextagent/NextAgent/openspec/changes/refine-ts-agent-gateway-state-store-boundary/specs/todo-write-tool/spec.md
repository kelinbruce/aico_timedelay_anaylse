# todo-write-tool Specification Delta

## Function

- **所属 Function**：`FN-5.7 管理待办`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: TodoWrite replaces the current list atomically

`TodoWrite` SHALL 是全量替换操作。成功的 `TodoWrite` invocation MUST 用输入 `todos` 表示的新列表替换 current projection，后者由 checkpoint-backed `flowVariables.todoWriteState` 承载。输入数组为空时，系统 MUST 清空当前列表。输入数组非空且所有 item 的 `status` 均为 `completed` 时，系统 MUST 清空对 channel/UI 暴露的当前列表，避免已完成清单长期停留。TodoWrite MUST NOT 通过 gateway store 持久化 todo state；current todo state 的持久化与恢复由 checkpoint `flowVariables.todoWriteState` 承担，进程重启或 stateless 实例恢复时由 checkpoint 恢复提供 current projection。同一 trusted invocation 的重复执行 MUST 返回与首次 invocation 相同的结果，MUST NOT 产生额外副作用；幂等由 recovery replay guard（`REUSE_RESULT` 或纯函数 `REPLAY_ALLOWED`）承担，MUST NOT 依赖 gateway invocation-key dedup。

**需求类别**：功能性需求

#### Scenario: New list replaces existing list

- **WHEN** 当前 trusted scope 已有 todo list
- **AND** 模型调用 `TodoWrite` 提交一个合法且不全为 `completed` 的 `todos` 数组
- **THEN** 系统 MUST 用提交的 `todos` 完整替换旧列表
- **AND** 旧列表中不存在于新数组的 item MUST 不再出现在当前 projection 中

#### Scenario: Empty input clears the list

- **WHEN** 当前 trusted scope 已有 todo list
- **AND** 模型调用 `TodoWrite` 且 `todos=[]`
- **THEN** 系统 MUST 清空当前 todo list state
- **AND** 当前 projection MUST 显示为空列表

#### Scenario: All completed input clears stored projection

- **WHEN** 模型调用 `TodoWrite` 且 `todos` 非空，并且所有 item 的 `status` 都是 `completed`
- **THEN** 系统 MUST 将当前 trusted scope 的 stored todo list 设置为空列表
- **AND** channel/UI projection MUST 不再显示这些已完成 item
- **AND** 成功 result 中的 `newTodos` MUST 为空列表

#### Scenario: Repeated invocation is idempotent

- **WHEN** 同一 owner/agent/session/request/run/context/tool-call 坐标下重复执行同一个 `TodoWrite` invocation
- **THEN** 系统 MUST 返回与首次 invocation 相同的 `newTodos`
- **AND** current projection MUST NOT 因重复执行再次变化
- **AND** MUST NOT 产生额外 gateway 持久化副作用

#### Scenario: Checkpoint recovery restores current state

- **WHEN** 一个 NextAgent 进程在 `TodoWrite` 成功后因故障或重启恢复
- **AND** checkpoint 已持久化 `flowVariables.todoWriteState`
- **THEN** 恢复后的进程 MUST 从 checkpoint 读取 current todo projection
- **AND** 未完成 todo MUST 在后续 model context 中可见
- **AND** 系统 MUST NOT 依赖 gateway store 读取 current state

#### Scenario: Multiple writes in one session append ordered revisions

- **WHEN** 同一 owner/agent/session scope 内连续成功调用 `TodoWrite` 多次
- **THEN** checkpoint recovery evidence MUST 保留每次成功写入后的顺序状态
- **AND** current projection MUST 等于最后一次写入的 `todos`
- **AND** 系统 MUST NOT 因这些写入创建 gateway todo revision

#### Scenario: Stateless app instances share persisted current state

- **WHEN** 一个 NextAgent 实例成功调用 `TodoWrite`
- **AND** 另一个 NextAgent 实例通过同一 trusted checkpoint 恢复同一 owner/agent/session scope
- **THEN** 第二个实例 MUST 读取到第一个实例写入的最新 current projection
- **AND** 进程重启 MUST NOT 丢失 checkpoint 中未完成 todo 的 current projection

### Requirement: TodoWrite returns safe structured results

成功的 `TodoWrite` invocation SHALL 返回 safe structured payload，包含本次写入后的 `newTodos`。`newTodos` MUST 只包含合法 todo item 字段。失败结果 MUST 使用 safe reason code，且 MUST NOT 暴露 hidden prompt、raw model context、provider-private facts、host path、credential、token、tenant secret 或未授权 scope 信息。系统 MUST NOT 返回 `oldTodos`；TodoWrite output schema 只 required `newTodos`。

**需求类别**：功能性需求

#### Scenario: Successful result contains resulting todo list

- **WHEN** `TodoWrite` 成功处理合法输入
- **THEN** result structured payload MUST 包含本次写入后的当前 `newTodos`
- **AND** 每个 result todo item MUST 只包含 `content`、`activeForm` 和 `status`
- **AND** result MUST NOT 包含 `oldTodos` 字段

#### Scenario: Failure result is safe

- **WHEN** `TodoWrite` 因 invalid input、aborted 或 unexpected execution failure 不能完成
- **THEN** 系统 MUST 返回 safe failure result
- **AND** failure result、日志、审计、trace 和 metric MUST NOT 包含 raw hidden context、credential、token、provider-private metadata 或其他 scope 的 todo list 内容

#### Scenario: Successful result contains old and resulting todo lists

- **WHEN** `TodoWrite` 成功处理合法输入
- **THEN** result structured payload MUST 包含调用前当前 trusted scope 的 `oldTodos`
- **AND** MUST 包含本次写入后的当前 `newTodos`
- **AND** 每个 result todo item MUST 只包含 `content`、`activeForm` 和 `status`

### Requirement: TodoWrite observability is low-cardinality and non-sensitive

系统 SHALL 为 `TodoWrite` invocation 产生可追踪但低敏的观测事实。日志、审计、trace 和 metric MAY 包含 capability id、status、safe reason code、item count、各 status 计数和 duration bucket；MUST NOT 记录完整 todo 文本、hidden context、模型原始输入、身份覆盖字段、credential、token 或 provider-private facts。TodoWrite observability MUST NOT 依赖 gateway persistence 事件；观测事实由 runtime/capability execution path 派生。

**需求类别**：功能性需求

#### Scenario: Invocation is observed without todo text leakage

- **WHEN** `TodoWrite` 成功或失败
- **THEN** observability output MUST 能按 invocation id 和 capability id 关联该调用
- **AND** MAY 包含 item count、status 计数和 duration bucket
- **AND** MUST NOT 包含完整 `content` 或 `activeForm` 文本

#### Scenario: TodoWrite observability is not owned by Tool metadata

- **WHEN** `TodoWrite` descriptor and Tool definition are loaded
- **THEN** its low-cardinality diagnostics MUST be derived by runtime/observability owners
- **AND** `TodoWrite` Tool metadata MUST NOT define a Tool-specific observability projector

#### Scenario: Gateway persistence is observed without todo text leakage

- **WHEN** `TodoWrite` checkpoint state is persisted, restored, cleared, or fails
- **THEN** diagnostics MAY include operation, success/failure outcome, old/new item counts, safe error code/category, retryability, and duration bucket
- **AND** diagnostics MUST NOT include full `content`, full `activeForm`, raw prompt/model output, credential, token, host path, or untrusted scope override fields.

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：TodoWrite 不再通过 gateway store 持久化 todo state，改为由 checkpoint-backed `flowVariables.todoWriteState` 承载 current state 的持久化与恢复；output 移除 `oldTodos`；幂等由 recovery replay guard 承担。
- **依据 Requirements**：`TodoWrite replaces the current list atomically`、`TodoWrite returns safe structured results`、`TodoWrite observability is low-cardinality and non-sensitive`

### 输入

- **变更类型**：修改
- **目标内容**：TodoWrite input 保持 `todos` 数组不变；output 只包含 `newTodos`，不再包含 `oldTodos`。
- **依据 Requirements**：`TodoWrite returns safe structured results`

### 处理过程

- **变更类型**：修改
- **目标内容**：TodoWrite execute 改为纯 input-validation + all-completed 清空操作，不调用 gateway store；current state 写入由 `agent-core` `applyRequestLocalResultEffects` 从 `structuredPayload.newTodos` 读取并写入 `flowVariables.todoWriteState`；进程重启/stateless 实例恢复由 checkpoint 恢复承担。
- **依据 Requirements**：`TodoWrite replaces the current list atomically`

### 规格

- **规格项**：TodoWrite 持久化机制
- **变更类型**：修改
- **原规格值**：通过 `TodoStateStoreGateway` 持久化 revision history 和 current projection，gateway invocation-key 幂等
- **目标规格值**：不通过 gateway store 持久化；current state 由 checkpoint `flowVariables.todoWriteState` 承载；幂等由 recovery replay guard 承担
- **依据 Requirements**：`TodoWrite replaces the current list atomically`

- **规格项**：TodoWrite output
- **变更类型**：修改
- **原规格值**：返回 `{ oldTodos, newTodos }`
- **目标规格值**：返回 `{ newTodos }`，移除 `oldTodos`
- **依据 Requirements**：`TodoWrite returns safe structured results`

- **规格项**：TodoWrite observability 来源
- **变更类型**：修改
- **原规格值**：observability 包含 gateway persistence 事件
- **目标规格值**：observability 由 runtime/capability execution path 派生，不依赖 gateway persistence
- **依据 Requirements**：`TodoWrite observability is low-cardinality and non-sensitive`

### 接口

- **变更类型**：修改
- **目标内容**：移除 `TodoStateStoreGateway` port、`RuntimeTodoStatePort`、`todoState` Tool dependency；TodoWrite descriptor 移除 `requiredDependencies: ['todoState']`。
- **依据 Requirements**：`TodoWrite replaces the current list atomically`、`TodoWrite returns safe structured results`
