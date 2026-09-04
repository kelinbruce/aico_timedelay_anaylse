# FN-7.1 输出结构化日志

> 能力域 D7 可观测与审计 · 子域 [D7.1 日志与审计](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-7.1](../../../features/D7-可观测与审计/D7.1-日志与审计/F-7.1-结构化日志.md) |
| spec | `structured-logging`、`runtime-logging` |
| 接口 | 系统内部，观测事件 |

## 描述

系统通过观测事件输出结构化日志，经脱敏后写入，写入不阻塞请求终态。本地 operational physical destination 同时承载 `observation_derived`（安全 canonical lifecycle）和 `runtime_diagnostic`（本地 Model、Tool、error 原始诊断）两个 surface，使运维人员可以从同一日志串联复杂请求、读取可信 terminal 汇总、识别错误分类并定位实际部署与 package owner。

本地 runtime diagnostic 保留 Tool 的 canonical `toolInput` 和去除 `generatedMessages` 正文后的 `toolOutput`；移除全部 `SYSTEM` message 后的 canonical `modelInput`；规范化 Model final result 的 `content`、`toolCalls`、`finishReason`、`usage` 和 `safeError`；以及执行异常的 `rawExceptionData`（message、stack、cause、sandbox path、URL）。这些 special field 只对 credential 和认证类 token 做窄匹配脱敏，prompt、路径、命令、stdout、stderr 和普通业务内容保持可诊断。每个 run-bound Model terminal summary 直接给出同一计时边界内的 `durationMs`、条件性 `firstContentLatencyMs` 和已有 normalized usage，使单条终态日志足以判断调用成本与响应速度。

## 前置条件

- 系统产生日志输出。
- 可信 deployment entrypoint 已提供有效 `serviceVersion`。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 观测事件 | 是 | 业务模块输出的观测事件 |
| 可信执行坐标 | 否 | 启用 tracing 时由 timeline span lifecycle 与当前 execution scope 提供的 `traceId`/`spanId` |

## 输出

脱敏后的结构化日志。Terminal entry 额外输出 `status`、聚合 Model usage、`toolCallCount` 与 `summaryStatus`。

## 处理过程

1. 业务模块通过观测事件输出，`observation_derived` 与 `runtime_diagnostic` 分别只经 `ObservabilityProjectorHost` 或 direct runtime logger 进入同一 physical destination。
2. 日志经脱敏处理。
3. 启用 tracing 时，lifecycle、Model/Tool payload 与 execution exception entry 输出由可信 span context 产生的 `traceId` 和 boundary `spanId`，并保留既有 run、step、invocation 坐标；普通 caller 提交的 trace 字段被忽略。
4. `StructuredLogProjector` 按 `runId` 维护有界 accumulator，对 timeline event 与 capability invocation 去重，在 terminal 输出可证明完整性的 usage、`toolCallCount` 和 `summaryStatus`；无法证明完整时标记 `PARTIAL`，不为未知统计伪造零值。
5. `error` level entry 在缺少批准分类字段时注入 `safeReasonCode=UNCLASSIFIED_RUNTIME_ERROR`；存在稳定 `event` 的 entry 不输出 `msg`/`message`，Fastify native access record 保留既有 native `msg`。
6. 结构化日志写入，有背压策略。
7. 写入不阻塞请求终态提交。

## 结果

- 正常：日志写入成功。
- 背压：降级为聚合摘要。
- Terminal：输出 canonical `status`、已知 usage/tool 统计与 `COMPLETE|PARTIAL` 完整性标识。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 单请求最大日志事件数 | 200 | 建议评审值 | 建议补充 |
| 日志字段最大长度 | 2,000 字符 | 建议评审值 | 建议补充 |
| 日志采样率 | 错误 100%、信息 100%、调试默认 0% | 建议评审值 | 建议补充 |
| 日志 surface | `observation_derived` 承载安全 canonical lifecycle，`runtime_diagnostic` 承载 local Model、Tool、error 原始诊断；两者写入同一 operational physical destination | 稳定 | `runtime-logging`：`Operational entry 使用可信执行关联坐标`、`Error 和 structured event 使用单一诊断身份` |
| 执行关联 | 启用 tracing 时使用可信 `traceId`、boundary `spanId` 及 run、step、invocation 坐标；无可信 span 时省略 trace 坐标 | 稳定 | `runtime-logging`：`Operational entry 使用可信执行关联坐标` |
| 请求终态汇总 | `status`、Model token usage、Tool invocation 数量及 `COMPLETE|PARTIAL` 完整性 | 稳定 | `runtime-logging`：`Request terminal entry 提供可验证汇总` |
| 日志身份 | 实际 deployment `serviceVersion`、owning package `component`、稳定 `event` 或 Fastify native `msg` 的单一消息身份 | 稳定 | `runtime-logging`：`Error 和 structured event 使用单一诊断身份`、`Operational entry 使用真实 deployment 和 package identity` |
| 本地 special fields | `toolInput`、`toolOutput`（去除 `generatedMessages` 正文，保留 count/kinds）、`modelInput`（去除全部 SYSTEM message，只含 `messages`）、`modelOutput`（content/toolCalls/finishReason/usage/safeError）、`rawExceptionData`（message/stack/cause/path/URL）；只窄脱敏 credential/token，不脱敏 prompt/path/command/business content | 稳定 | `runtime-logging`：`Runtime log helpers are safe, diagnostic, and non-fatal`、`本地模型调用诊断记录可定位输入输出`、`本地 runtime 执行异常诊断保留受控详细信息` |
| 本地 special field 容量 | string 16 KiB、array 100 项、递归深度 6 层（从 special field 根值独立计数）、单 entry 1 MiB；超限保留前缀 + marker，不替换为 `entry_too_large` | 稳定 | `runtime-logging`：`Runtime log helpers are safe, diagnostic, and non-fatal`、`Runtime writer 使用精确字段分类和 typed marker` |
| Model terminal timing | 每个 `model.invocation.completed/failed` 包含 monotonic `durationMs`；存在 content/reasoning/Tool call feedback 时包含 `firstContentLatencyMs`（<= `durationMs`）；usage 原样投影，不估算补零 | 稳定 | `runtime-logging`：`正常执行使用单一可关联的安全日志目录` |
| 默认 info 降噪 | 每请求只保留一个带 method/route 的 final access record；成功 owner-scope-check 下沉 debug，失败保留 warn；同一 Skill source 持续不可用只写一次 warn；成功 trace/Hook confirmation 下沉 debug；完整 terminal 省略 COMPLETE 同义字段 | 稳定 | `runtime-logging`：`正常执行使用单一可关联的安全日志目录` |
| 外部隔离 | special field 不进入 Web API、stream、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent` | 稳定 | `runtime-logging`：`本地执行异常诊断不得扩散到产品输出面` |
