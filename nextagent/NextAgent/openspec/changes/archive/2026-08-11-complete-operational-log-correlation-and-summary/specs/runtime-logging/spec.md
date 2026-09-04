## Function

- **所属 Function**：`FN-7.1 输出结构化日志`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Operational entry 使用可信执行关联坐标

启用 tracing 时，每个由 timeline lifecycle 产生的 request、Model 和 Capability operational entry MUST 输出由该 timeline event 的可信 span context 产生的 `traceId` 和 `spanId`。`traceId` MUST 匹配 `^[0-9a-f]{32}$` 且不得全零；`spanId` MUST 匹配 `^[0-9a-f]{16}$` 且不得全零。同一 request 的 entry MUST 共享 `traceId`；同一 request、Model 或 Capability execution boundary 的 started、completed 和 failed entry MUST 使用该 boundary 的 `spanId`。

Model input/output 和 Tool input/output local runtime diagnostic MUST 在对应 execution boundary 内输出相同的 trace、run、step 和 invocation 坐标。Execution exception local runtime diagnostic MUST 输出捕获异常时所在 boundary 的可信 trace、run、step 和 invocation 坐标。普通 caller 提交的 `traceId` 或 `spanId` MUST 被忽略；系统 MUST NOT 从默认配置、相邻日志或任意字符串推断执行关联坐标。Tracing 未启用或可信 span context 不存在时，entry MUST 省略 `traceId` 和 `spanId`，且其它执行和日志行为 MUST 保持不变。

Trace 坐标只允许进入 local operational log 和 trace surface。它们 MUST NOT 进入 Web API、stream、timeline public projection、SafeError、audit、metric label、public DTO 或 `ObservabilityObservationEvent`。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性

**适用范围**：该 Function

#### Scenario: 复杂 Model 和 Tool 请求按 trace 关联

- **WHEN** 启用 tracing 的 request 依次产生 Model invocation、Tool invocation、后续 Model invocation 和 terminal event
- **THEN** 对应 lifecycle 与 local payload entry MUST 共享同一有效 `traceId`
- **AND** 每个 execution boundary MUST 输出其可信 `spanId` 和既有 run、step、invocation 坐标

#### Scenario: Caller 不能伪造 trace

- **WHEN** 普通 runtime caller 提交 `traceId` 或 `spanId`
- **THEN** writer MUST 忽略 caller 值
- **AND** 只有可信 execution correlation context 能设置最终 trace 坐标

#### Scenario: Tracing 关闭时日志行为降级

- **WHEN** deployment 未启用 tracing 或当前 boundary 没有可信 span context
- **THEN** operational entry MUST 省略 `traceId` 和 `spanId`
- **AND** request、Model、Capability、日志写入和 terminal 行为 MUST 保持不变

### Requirement: Request terminal entry 提供可验证汇总

`request.completed`、`request.failed` 和 `request.canceled` MUST 输出 canonical `status`，其值分别为 `SUCCEEDED`、`FAILED` 和 `CANCELED`。Terminal entry MUST 汇总该 run 中已观察到的 Model usage，并输出已知的 `usage.inputTokens`、`usage.outputTokens` 和 `usage.totalTokens`；它 MUST 输出全部已开始且具有唯一 `capabilityInvocationId` 的 Tool invocation 数量 `toolCallCount`。

只有当同一 projector instance 从 request accepted 到 terminal 连续观察该 run、每个已开始 Model invocation 都收到 terminal event、每个成功 Model terminal 都提供三个有效 usage 字段，且没有发生 projection queue overflow 时，`summaryStatus` 才能为 `COMPLETE`。其它情况 `summaryStatus` MUST 为 `PARTIAL`。`PARTIAL` 时系统 MUST 输出已知的非负统计，但 MUST NOT 为未知 usage 字段或未知 Tool 计数伪造零值。重复的 timeline event 或重复的 `capabilityInvocationId` MUST NOT 被重复计数。

Terminal entry MUST NOT 包含原始 exception message、stack 或 cause。失败根因 MUST 通过同一 run 的 local runtime error diagnostic 关联。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 完整 terminal 汇总

- **WHEN** projector 从 request accepted 到 terminal 连续观察两个都具有完整有效 usage 的成功 Model invocation 和三个唯一 Tool invocation
- **THEN** request terminal entry MUST 输出两个 Model usage 的逐项总和、`toolCallCount=3` 和 `summaryStatus=COMPLETE`
- **AND** `status` MUST 与 terminal event 类型一致

#### Scenario: 恢复后缺失中间事实

- **WHEN** projector 未观察 request accepted、任一 Model terminal、任一成功 Model usage 字段或发生 projection queue overflow 后收到 terminal event
- **THEN** terminal entry MUST 输出 `summaryStatus=PARTIAL`
- **AND** MUST 保留已知统计且不得为未知统计伪造零值

#### Scenario: 重放事件不重复计数

- **WHEN** projector 在同一 run 收到重复的 Model terminal timeline event 或重复的 `capabilityInvocationId`
- **THEN** terminal usage 和 `toolCallCount` MUST 各只计入一次

#### Scenario: 失败根因不在 terminal 重复

- **WHEN** request 因执行异常产生 runtime error diagnostic 和 `request.failed`
- **THEN** terminal entry MUST 只包含 status、safe reason、统计和关联字段
- **AND** 原始 message、stack 和 cause MUST 只存在于同一 run 的 local runtime error diagnostic

### Requirement: Error 和 structured event 使用单一诊断身份

每个 `error` level product operational entry MUST 包含至少一个批准的低基数诊断分类字段：`safeReasonCode`、`safeErrorCode`、`errorCode` 或 `recoveryCode`。Writer MUST 在上述字段均缺失时设置 `safeReasonCode=UNCLASSIFIED_RUNTIME_ERROR`；该兜底只表示 producer 尚未提供更精确分类，不得替代可用的原始异常诊断。Execution exception entry MUST 继续通过 local `rawExceptionData` 提供经 credential、认证 token 和 prompt 脱敏的根因。

存在稳定 `event` 的 entry MUST NOT 输出 `msg` 或 `message`。唯一例外是没有 operational `event` 的 Fastify native access record；其 `incoming request`、`request completed` 和 `request errored` MUST 保留 native `msg`、`reqId` 及既有安全 req/res shape，且 MUST NOT 伪造 operational `event`。

**需求类别**：系统质量属性

**质量属性**：可维护性

**适用范围**：该 Function

#### Scenario: Error entry 总有分类

- **WHEN** product code 写入一个未提供任何批准诊断分类字段的 `error` entry
- **THEN** physical entry MUST 输出 `safeReasonCode=UNCLASSIFIED_RUNTIME_ERROR`
- **AND** 可用的 `rawExceptionData` MUST 继续保留

#### Scenario: 稳定 event 不重复 msg

- **WHEN** writer 收到带稳定 `event` 和 caller message 的 structured entry
- **THEN** physical entry MUST 保留 `event` 和结构化字段
- **AND** MUST NOT 输出 `msg` 或 `message`

#### Scenario: Fastify native access 保留 msg

- **WHEN** Fastify 产生既有 native access record
- **THEN** writer MUST 保留批准的 native `msg`、`reqId` 和安全 req/res shape
- **AND** MUST NOT 为该 record 伪造 operational `event`

### Requirement: Operational entry 使用真实 deployment 和 package identity

所有 product operational entry MUST 输出由可信 deployment entrypoint 提供的 `serviceVersion`。Local 和 remote runtime package MUST 从 validated manifest `version` 与 `candidateId` 派生 bounded version；非 packaged product entrypoint MUST 从当前构建 package metadata 注入 version。Composition、normalizer 和 writer MUST NOT 在缺失或非法值时回退到硬编码 `1.0.0`、`unknown` 或其它共享占位值；缺失或非法 deployment version MUST 在创建 operational writer 前产生安全启动失败。

Product logger 的 `component` MUST 使用 owning package 的短名 `agent-*`；package 内角色、adapter 或子流程 MUST 使用 `source`。Writer MUST 继续校验 component 和 source 的 bounded token shape；架构验证 MUST 拒绝 product source 中与 owning package 不一致的静态 component binding。Test-only logger MAY 使用以 `agent-test-` 开头的 component fixture；选择该例外时 fixture MUST 只存在于 test source，product source MUST 继续使用 owning package component。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性

**适用范围**：该 Function

#### Scenario: Local package 标识实际 candidate

- **WHEN** validated local runtime package manifest 包含 version 和 candidateId
- **THEN** 全部 operational entry MUST 使用由二者派生的同一 bounded `serviceVersion`
- **AND** 该值 MUST 与同一 deployment 的 OTel resource version 一致

#### Scenario: 缺失 deployment version 启动失败

- **WHEN** product composition 未提供有效 `serviceVersion`
- **THEN** 系统 MUST 在创建 operational writer 前产生安全启动失败
- **AND** MUST NOT 回退到硬编码或共享占位 version

#### Scenario: Component 归属唯一

- **WHEN** product package 创建 logger
- **THEN** `component` MUST 等于 owning package 短名
- **AND** adapter、composition 或子流程名称 MUST 只进入 `source`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统输出可按可信 trace、run、step 和 invocation 关联，并包含请求终态汇总、明确错误分类、实际 deployment 与唯一 package owner 的 local operational log。
- **依据 Requirements**：`Operational entry 使用可信执行关联坐标`、`Request terminal entry 提供可验证汇总`、`Error 和 structured event 使用单一诊断身份`、`Operational entry 使用真实 deployment 和 package identity`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统验证 deployment identity，按可信执行坐标关联生命周期和 local diagnostic，在 terminal 汇总已验证的 request 统计，并用 event 或 native access message 表达唯一日志身份。
- **依据 Requirements**：`Operational entry 使用可信执行关联坐标`、`Request terminal entry 提供可验证汇总`、`Error 和 structured event 使用单一诊断身份`、`Operational entry 使用真实 deployment 和 package identity`

### 结果

- **变更类型**：修改
- **目标内容**：运维人员可以串联复杂请求、识别实际部署和 owner、读取错误分类，并判断 terminal 汇总是否完整。
- **依据 Requirements**：`Operational entry 使用可信执行关联坐标`、`Request terminal entry 提供可验证汇总`、`Error 和 structured event 使用单一诊断身份`、`Operational entry 使用真实 deployment 和 package identity`

### 规格

- **规格项**：日志 surface
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`observation_derived` 承载安全 canonical lifecycle，`runtime_diagnostic` 承载 local Model、Tool、error 原始诊断；两者写入同一 operational physical destination。
- **依据 Requirements**：`Operational entry 使用可信执行关联坐标`、`Error 和 structured event 使用单一诊断身份`

- **规格项**：执行关联
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：启用 tracing 时使用可信 `traceId`、boundary `spanId` 及 run、step、invocation 坐标；无可信 span 时省略 trace 坐标。
- **依据 Requirements**：`Operational entry 使用可信执行关联坐标`

- **规格项**：请求终态汇总
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`status`、Model token usage、Tool invocation 数量及 `COMPLETE|PARTIAL` 完整性。
- **依据 Requirements**：`Request terminal entry 提供可验证汇总`

- **规格项**：日志身份
- **变更类型**：修改
- **原规格值**：无 stable Requirement 支撑的 deployment/package identity 规格值。
- **目标规格值**：实际 deployment `serviceVersion`、owning package `component`、稳定 `event` 或 Fastify native `msg` 的单一消息身份。
- **依据 Requirements**：`Error 和 structured event 使用单一诊断身份`、`Operational entry 使用真实 deployment 和 package identity`

### 主规格

- **变更类型**：修改
- **目标内容**：`runtime-logging`
- **依据 Requirements**：`Operational entry 使用可信执行关联坐标`、`Request terminal entry 提供可验证汇总`、`Error 和 structured event 使用单一诊断身份`、`Operational entry 使用真实 deployment 和 package identity`
