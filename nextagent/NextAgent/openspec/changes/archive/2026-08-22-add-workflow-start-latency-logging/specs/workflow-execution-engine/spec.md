# workflow-execution-engine Specification

## Function

- **所属 Function**：`FN-9.1 执行工作流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 工作流启动里程碑诊断日志

`InMemoryWorkflowExecutionService.execute()` 在 recipe version 校验通过后、`executePath` 之前 MUST 输出一条 info 级别 runtime diagnostic log，不得对执行路径产生额外副作用。

该事件 MUST 命名为 `workflow.execution.started`，并且 MUST 携带以下字段：
- `executionId`：workflow execution 的标识（string）。
- `recipeName`：recipe 的名称（string）。
- `runId`：所属 request run 的标识（string）。
- `startedAtEpochMs`：workflow 启动的 epoch 毫秒时间戳（number），= `this.now().getTime()`。

该事件仅用于本地运行诊断。事件 MUST NOT 写入 timeline event、audit、metric、trace 或 Web API response，且字段 MUST NOT 包含 prompt、模型输出、credential、路径或高基数字段。

与既有的 `workflow.node.started`（debug，节点级）不同，`workflow.execution.started` 是流程级启动里程碑，两者不重复：前者记录单个节点执行启动，后者记录整个 workflow execution 启动。

只有经 `workflowExecutionService.execute()` 执行且 run 为 DETERMINISTIC_FLOW 路由（携带 `recipeName` 且为 workflow run）的 run 才输出该事件；非 workflow run（MODEL_DRIVEN_LOOP）MUST NOT 输出该事件。

latency 计算以 `startedAtEpochMs` 与 `runtime.run.dispatched` 的 `runCreatedAtMs` 通过 `runId` 作为 join key 对齐，支持纯日志计算 `latency = startedAtEpochMs - runCreatedAtMs`，度量 accept 到 workflow start 的时延（含排队等待时间）。

**需求类别**：功能性需求

#### Scenario: 工作流 run 启动时输出诊断事件

- **WHEN** 一个 DETERMINISTIC_FLOW run 进入 `workflowExecutionService.execute()` 且 recipe version 校验通过
- **THEN** engine MUST 在 `executePath` 之前输出 `workflow.execution.started` info 级别日志
- **AND** 日志 MUST 携带 `executionId`、`recipeName`、`runId`、`startedAtEpochMs`
- **AND** `startedAtEpochMs` MUST 为 epoch 毫秒时间戳

#### Scenario: 诊断事件不进入持久化 timeline

- **WHEN** `workflow.execution.started` 事件被输出
- **THEN** 该事件 MUST NOT 写入 timeline store 中
- **AND** MUST NOT 写入 audit log 中
- **AND** MUST NOT 产生 metric sample 中
- **AND** MUST NOT 产生 trace span 中
- **AND** MUST NOT 出现在 Web API response 中

#### Scenario: 非工作流 run 不输出该事件

- **WHEN** 一个 MODEL_DRIVEN_LOOP run 被调度执行
- **THEN** 该 run MUST NOT 输出 `workflow.execution.started` 事件
- **AND** 该 run 仍然输出 `runtime.run.dispatched` 事件

## Function Change Summary

### Specifications

| Specification Item | Change Type | Target Specification Value | Requirement Evidence |
| --- | --- | --- | --- |
| 工作流启动里程碑诊断日志 | ADDED | Engine 在 `execute()` 中 recipe version 校验通过后输出 info 级别 diagnostic log `workflow.execution.started`，携带 `executionId`、`recipeName`、`runId`、`startedAtEpochMs`，不进入 timeline、audit、metric、trace 或 Web API，支持纯日志计算 accept 到 workflow start latency。 | 工作流启动里程碑诊断日志 |
