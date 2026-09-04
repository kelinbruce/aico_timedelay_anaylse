# workflow-contracts Delta Specification

所属 Function：`FN-9.1 执行工作流`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: Workflow 节点重试不重放 Capability 最终失败

Workflow engine MUST 对声明节点级 timeout 的非 Capability 节点在该时限到达时终止当前 attempt，并把该 attempt 作为可求值的节点失败。非 Capability 节点发生 timeout 或其他可重试节点失败、且已经消耗的 retry 次数小于节点声明值时，engine MUST 启动下一节点 attempt；每个 attempt MUST 重新建立该节点声明的完整 timeout。总 attempt 数 MUST 等于初始 attempt 加实际执行的 retry 次数。retry 耗尽后，engine MUST 停止启动新 attempt，并求值当前节点显式 `exception`；存在匹配分支时 MUST 只执行该分支，分支声明跳过时产生 skipped 结果，不存在匹配分支时 Workflow MUST 失败。

当节点调用 Capability 时，节点 retry 次数 MUST 只作为统一执行边界内部的 `CapabilityInvocationRequest.maxRetries` 上限。当节点失败来源是统一执行边界返回的最终 `CapabilityInvocationResult` 时，engine MUST NOT 根据节点 retry 配置、`safeError.retryable` 或 timeout 再次执行该节点。Capability 的同参自动重试 MUST 在最终结果返回前完成；最终结果返回后，Workflow 对该逻辑调用的自动重试次数 MUST 为 `0`。

**需求类别**：功能性需求

#### Scenario: 非 Capability 节点按声明重试

- **WHEN** 非 Capability 节点 attempt 超时或返回可重试节点失败
- **AND** 节点仍有声明的 retry 次数
- **THEN** engine MUST 启动下一 attempt
- **AND** 下一 attempt MUST 获得该节点声明的完整 timeout

#### Scenario: 非 Capability 节点重试耗尽

- **WHEN** 非 Capability 节点已耗尽声明的 retry 次数
- **THEN** engine MUST 停止启动新 attempt
- **AND** 存在匹配显式 exception 时 MUST 只执行该分支
- **AND** 分支声明跳过时 MUST 产生 skipped 结果
- **AND** 不存在匹配 exception 时 Workflow MUST 失败

#### Scenario: Capability 最终失败不执行 Workflow retry

- **WHEN** Capability 节点返回最终 `FAILED` 或 `TIMED_OUT`
- **AND** 节点声明了 retry
- **THEN** engine MUST NOT 再次执行该节点
- **AND** engine MUST 继续求值当前节点显式 `exception`
- **AND** 节点 retry 次数 MUST 只约束已经结束的逻辑 Capability invocation 内部 attempt 上限

### Requirement: 最终 Capability 失败统一求值显式 exception

除以下两类控制结果外，Workflow engine MUST 对全部最终 Capability 失败求值当前节点声明的显式 `exception`：

1. 最终 `safeError.category=CANCELED` 或父 `AbortSignal` 已取消时，系统 MUST 立即中断且 MUST NOT 求值普通 `exception`。
2. Recipe 通过 `on_poll_error=skip` 或 `batchFailStrategy=continue` 明确消费 poll/batch 单项失败时，系统 MUST 记录安全单项失败并继续，且 MUST NOT 重放该单项。

适用 category MUST 包含 `VALIDATION`、`NOT_FOUND`、`CONFLICT`、`UNAVAILABLE`、`TIMEOUT`、`AUTHORIZATION`、`POLICY_DENIED` 和 `INTERNAL`；适用 code MUST 包含 `CAPABILITY_OUTPUT_INVALID` 和 `CAPABILITY_RESULT_UNKNOWN`；缺失或非法 `safeError` 被规范化后的安全内部失败同样适用。engine MUST 使用最终 `safeError` 生成 Recipe exception 变量 `error`，并 MUST 保留上游业务 code 和 message。

存在匹配 `exception` 时，engine MUST 只执行该显式分支；不存在匹配 `exception` 时，Workflow MUST 失败。框架 MUST NOT 在 `exception` 之外推断补偿、降级或重放动作。外部取消触发的 cancel fallback MUST 遵守声明的取消策略，MUST NOT 因 fallback 中的 Capability 失败进入普通 `exception` 或 retry。

Recipe 可见 `error` 变量 MUST 遵守 canonical Workflow error contract；本 Requirement MUST NOT 增加或删除该结构中的字段。

**需求类别**：功能性需求

#### Scenario: 输出无效进入显式 exception

- **WHEN** Capability 最终返回 `CAPABILITY_OUTPUT_INVALID`
- **AND** 当前节点声明匹配的 `exception`
- **THEN** engine MUST 使用该安全 code 和 message 求值 `exception`
- **AND** engine MUST NOT 自动重新执行 Capability

#### Scenario: 不可恢复失败进入显式 exception

- **WHEN** Capability 最终返回 `AUTHORIZATION`、`POLICY_DENIED`、`INTERNAL` 或 `CAPABILITY_RESULT_UNKNOWN`
- **THEN** engine MUST 求值当前节点显式 `exception`
- **AND** engine MUST NOT 在求值前自动重试 Capability

#### Scenario: 没有 exception 时 Workflow 失败

- **WHEN** Capability 最终失败且当前节点没有匹配 `exception`
- **THEN** Workflow MUST 结束为失败
- **AND** engine MUST 保留最终安全错误事实

#### Scenario: 取消不进入 exception

- **WHEN** Capability 最终返回 `safeError.category=CANCELED` 或父 `AbortSignal` 已触发
- **THEN** engine MUST 停止启动普通正向节点，并按声明的 cancel policy 决定是否执行 fallback
- **AND** engine MUST NOT 求值普通 `exception`
- **AND** 未配置 cancel fallback 时 Workflow MUST 返回中断结果

#### Scenario: 取消回退中的 Capability 失败不进入普通处置

- **GIVEN** 外部取消已经使 Workflow 进入声明的 cancel fallback
- **WHEN** fallback 中的 Capability 节点返回最终 `FAILED` 或 `TIMED_OUT`
- **THEN** engine MUST NOT 根据该节点的 retry 配置再次执行 Capability
- **AND** engine MUST NOT 求值该节点的普通 `exception`
- **AND** Workflow MUST 按声明的 cancel fallback 失败规则返回中断结果

### Requirement: Capability exception 仅观察最终失败事实

Workflow MUST 只把最终 Capability `safeError` 投影到显式 `exception`。统一执行边界的中间 retry attempt MUST NOT 进入 Recipe 变量、Workflow event 或 exception 求值。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：`FN-9.1 执行工作流`

#### Scenario: 中间 retry attempt 对 Workflow 不可见

- **WHEN** 统一 Capability 执行边界的第一次 attempt 失败且第二次 attempt 成功
- **THEN** Workflow 节点 MUST 只观察成功结果
- **AND** engine MUST NOT 求值 `exception`
- **AND** Workflow event MUST NOT 包含第一次失败内容

#### Scenario: 最终失败只投影安全字段

- **WHEN** 统一执行边界返回最终失败
- **THEN** engine MUST 只基于最终 `safeError` 求值 `exception`
- **AND** 中间 attempt 的 `safeError` MUST NOT 进入 exception 上下文

### Requirement: Workflow 节点等待状态投影为成功控制结果

Workflow engine 产生 `NODE_WAITING` 事件时，runtime timeline projection MUST 把该事件投影为 `CAPABILITY_COMPLETED`，其 `inlinePayload.status` MUST 为 `SUCCEEDED`，`reasonCode` MUST 为 `WORKFLOW_NODE_WAITING`。等待状态是协议控制结果，不是降级或失败；timeline projection MUST NOT 把 `NODE_WAITING` 投影为 `DEGRADED`。

**需求类别**：功能性需求

#### Scenario: NODE_WAITING 投影为 SUCCEEDED

- **WHEN** Workflow engine 产生 `NODE_WAITING` execution event
- **THEN** timeline projection MUST 产生 `CAPABILITY_COMPLETED` 事件
- **AND** `inlinePayload.status` MUST 为 `SUCCEEDED`
- **AND** `inlinePayload.reasonCode` MUST 为 `WORKFLOW_NODE_WAITING`
- **AND** projection MUST NOT 携带 `safeError`

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：Workflow 中的 Capability 最终失败统一由显式 exception 决定后续流程。
- 依据 Requirements：`最终 Capability 失败统一求值显式 exception`

### 输入

- 变更类型：修改
- 目标内容：engine 消费节点上升的最终 Capability `safeError` 和节点显式 exception 定义。
- 依据 Requirements：`最终 Capability 失败统一求值显式 exception`

### 输出

- 变更类型：修改
- 目标内容：匹配 exception 时进入显式分支；无匹配分支时 Workflow 失败；取消返回中断。
- 依据 Requirements：`最终 Capability 失败统一求值显式 exception`

### 处理过程

- 变更类型：修改
- 目标内容：Capability 最终失败不进入 Workflow 节点 retry；中间 retry attempt 对 Workflow 不可见；非 Capability 节点每次 attempt 使用完整节点 timeout，并在 retry 耗尽后进入显式 exception、skipped 或失败结果。
- 依据 Requirements：`Workflow 节点重试不重放 Capability 最终失败`、`Capability exception 仅观察最终失败事实`

### 结果

- 变更类型：修改
- 目标内容：Workflow 作者能够在显式 exception 中决定查询、补偿、告警、转人工或降级，框架不隐式重复调用 Capability；`NODE_WAITING` 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING` 控制结果。
- 依据 Requirements：`最终 Capability 失败统一求值显式 exception`、`Workflow 节点等待状态投影为成功控制结果`

### 规格

- 规格项：Workflow 收到 Capability 最终失败后的自动重试次数
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：`0` 次/节点最终失败；从节点收到最终 `CapabilityInvocationResult` 起，到进入 exception、cancel fallback failure 或 Workflow 失败结束
- 依据 Requirements：`Workflow 节点重试不重放 Capability 最终失败`
