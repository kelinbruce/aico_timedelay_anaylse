## 背景和现状

LOG surface 需要从统一 observation stream 生成正式业务诊断日志。当前代码基线已经有 `StructuredLogProjector`、`createStructuredLogger`、metrics / audit / trace 的直接 projector 调用和 app composition 中的若干直接写出路径；本 change 将其收敛为 `ObservabilityProjectorHost` fixed projector 模式。

## 第一性原理

结构化日志的唯一职责，是把已成立的业务事实和系统事实投影为安全、稳定、可机器消费的诊断记录。日志用于定位和解释，不是 request truth、terminal truth、audit truth、metric sample、health truth、trace span 或 replay source。

## 黑盒目标

系统可以对智能体请求、runtime lifecycle、model invocation、capability invocation、gateway call、hook/policy、attachment、safe error、large content、system runtime 和 observability degradation 输出统一 `StructuredLogEntry`。operator 不读取 raw payload，也能看到事实所属 owner、request/run、边界、操作、结果、耗时、token usage、安全原因和降级状态。

## 非范围与安全排除

本 change 不定义 observation acquisition、runtime listener、wrapper taxonomy、DiagnosticContext、`ObservabilityObservationEvent` shape、projector host、AUDIT truth、metric inventory、health judgment 或 trace exporter。

本 change 不新增 `TimelineEventType`，不实现多 sink fan-out、远端日志 exporter、文件 JSONL flush、后台补采、日志回放、业务包可调用 logger port 或 logger SDK 泄漏。

LOG output 只允许安全、低基数、可脱敏字段。raw prompt、raw thinking、raw model output、tool args/result、attachment body、raw provider response、path、credential、secret、token、stack trace、free-text reason、动态 payload、trace id/span id、高基数字段和未授权对象存在性细节不得进入 `StructuredLogEntry`。

## 核心对象

### StructuredLogEntry

`StructuredLogEntry` 是 LOG surface 的正式输出对象。它至少包含：

- `timestamp`：日志输出时间或 observation occurredAt 的安全投影时间。
- `level`：`info`、`warn`、`error`。
- `event`：稳定日志事件名，不等同于 timeline event type。
- `ownerScope`：`tenantId`、`subjectId`、`agentId`、`agentVersion`。
- `correlation`：`sessionId`、`requestRunId`、`requestContextId`、`messageId`、`timelineEventId`、`capabilityInvocationId` 等 owner-safe refs。
- `boundary` / `operation`：来源边界和稳定操作名。
- `outcome`：低基数结果。
- `processState`：status、phase、retryable、safeErrorCategory 等低基数字段。
- `costLatency`：可选 `durationMs`。
- `costUsage`：可选 normalized `ModelUsage`，字段为 `inputTokens`、`outputTokens`、`totalTokens`。
- `safeSummary`：有界安全摘要。

### StructuredLogProjector

`StructuredLogProjector` 是 `ObservabilityProjectorHost` 的 fixed projector。它只消费 `ObservabilityObservationEvent`，执行 LOG coverage、field selection、redaction 和 transport write。

### StructuredLogTransport

`StructuredLogTransport` 是 `agent-observability` 内部 sink adapter。首版产品输出目标固定为 `createStructuredLogger` 包装的 Pino transport。业务 package 不直接调用 transport、logger helper 或 Pino。

### StructuredLogProjectionPolicy

`StructuredLogProjectionPolicy` 决定 LOG coverage、事件名、level、allowed fields 和 redaction surface。coverage 不写入 observation event。

## 唯一产品路径

1. `add-ts-trace-log-linking` 负责 runtime listener / wrappers / system producer 生成 `ObservabilityObservationEvent` 并调用 `ObservabilityProjectorHost.acceptObservation(event): void`。
2. `ObservabilityProjectorHost` 异步调用 `StructuredLogProjector`。
3. `StructuredLogProjector` 判断 LOG coverage，映射 `StructuredLogEntry` 候选。
4. projector 执行 LOG redaction 和 schema validation。
5. projector 调用 `StructuredLogTransport` 写出。
6. 写出失败返回 `degraded` / `failed_closed`，并产生 bounded logging degradation evidence。

这条路径替代 app / business package 直接调用 logger、wrapper 直接写日志、structured-log-only observation event、logging event bus 和从 audit/metric/trace/health 输出回放生成日志的路径。

## LOG Coverage 清单

| Log event | 业务事实 | 输入来源 | event 状态 / wrapper | timeline payload 增强 | 生成规则 |
|---|---|---|---|---|---|
| `request.accepted` | 请求被接受 | `REQUEST_ACCEPTED` | 已有 timeline event | 无 | level `info`，记录 refs/status |
| `request.rejected` | run 创建前请求被拒绝 | `RuntimeCommandPort` wrapper | 当前已由 `agent-app` composition 接入 | 无 | failure / denied 级别按 policy，记录 ownerScope、entrypoint refs、safe reason |
| `request.terminal` | 请求终态 | `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` / `REQUEST_SUPERSEDED` | 已有 timeline event | 无 | success info；failure/canceled warn/error by policy |
| `model.invocation.completed` | 模型调用成功 | `ModelInvocationService` wrapper observation | wrapper observation | `durationMs` + optional `usage` 由 trace-log-linking wrapper 生成 | 记录 providerKind、duration、usage、outcome |
| `model.invocation.failed` | 模型调用失败 | `ModelInvocationService` wrapper observation | wrapper observation | `durationMs` + safe reason + optional `usage` 由 trace-log-linking wrapper 生成 | 记录 safeErrorCode/category、duration、usage |
| `capability.invocation.started` | capability 开始 | `CAPABILITY_STARTED` | 已有 timeline event | 无 | 记录 capability refs，不记录 args |
| `capability.invocation.completed` | capability 完成 / 失败 / 降级 | `CAPABILITY_COMPLETED` | 已有 timeline event | `durationMs` 由 trace-log-linking 补强 | 记录 capability kind/id、status、safe reason、duration |
| `stream.visible_content` | 可见 content stream timing | `LLM_CONTENT_DELTA` / normalized stream observation | 已有 event 可用于 safe refs；normalized stream timing wrapper 后续实现 | 无 | 不记录 content；用于关键 stream diagnostics 时输出 |
| `degradation.notice` | 已发布降级事实 | `DEGRADATION_NOTICE` | 已有 timeline event | 无 | 记录 safe code/category |
| `gateway.call` | gateway 调用 outcome | `GatewayPort` wrapper | 后续 gateway owner wrapper | 无 | 记录 gatewayCategory、operation、duration、safe reason |
| `hook.policy` | hook / policy 执行诊断 | hook / policy wrapper | 后续 hook / policy owner wrapper | 无 | 记录 hook stage、policy decision、safe reason |
| `attachment.intake` | attachment 接受 / 拒绝 / 可用性 | `ATTACHMENT_*` 或 `AttachmentIntakeRead` wrapper | event / wrapper 由 attachment owner 后续实现 | 无 | 不记录 filename path/body；记录 media class、size class、safe reason |
| `safe_error.emitted` | safe error 输出 | `SafeErrorOutput` wrapper | 后续 safe error owner wrapper | 无 | 记录 safe error code/category/retryable |
| `large_content.operation` | 大内容 externalize / summarize / load | attachment/capability/context wrapper | 后续 owner wrapper | 无 | 记录 size class、operation、outcome，不记录内容/path |
| `web.entrypoint` | Web transport completion | channel entrypoint middleware | middleware observation | 无 | 只记录 route category/status family/duration |
| `system.runtime` | app bootstrap/config/server/sink status | system observation producer | system observation | 无 | 不伪装 request lifecycle |
| `logging.degraded` | LOG projector / transport 降级 | host/projector internal degradation observation | internal degradation | 无 | 记录 safe reason，不回放其它 surface |

本 change 不新增 timeline event。`ATTACHMENT_*`、large-content、hook/policy、gateway 等后续若由业务 owner 定义 timeline event，必须在 owner change 中说明 safe payload、persistence purpose、channel projection impact 和 observation mapper impact。
本 change 的代码实现落地 LOG projector、当前已存在 acquisition source 的消费，以及 pre-run rejection 所需的 `RuntimeCommandPort` wrapper 消费；后续 wrapper 行表示允许且必须遵循的接入方式，不表示当前已经实现对应采集器。

## 从 Observation 到 StructuredLogEntry 的映射

1. 读取 observation 的 `ownerScope`、`occurredAt`、`boundary`、`operation`、`outcome`、`stableRefs`、`durationMs`、`usage`、`safeReasonCode` 和 `diagnosticSnapshot`。
2. 调用 `StructuredLogProjectionPolicy.covers(event)`。未覆盖返回 `skipped_not_covered`。
3. 按 coverage 选择稳定 log `event` 和 `level`。
4. 映射 `correlation`：只复制已存在 owner-safe refs，缺失则省略。
5. 映射 `processState`：只包含低基数 status、phase、providerKind、capabilityKind、gatewayCategory、safeErrorCategory、retryable。
6. 映射 `costLatency.durationMs` 和 `costUsage`；非法值 fail closed 或降级。
7. 执行 LOG redaction，生成 schema-stable `StructuredLogEntry`。
8. 调用 transport 写出；失败产生 logging degradation evidence。

`usage` 直接复用 `ModelUsage` shape，不引入 `modelInputTokens` 等二次命名。`durationMs` 是可选字段，只有 owning event / wrapper 准确测量时写入。

## 失败与降级

- redaction failure、schema validation failure、serialization failure：返回 `failed_closed` 或 `degraded`，不写 raw fallback。
- transport unavailable / write failure：返回 `degraded`，业务结果不变。
- 缺失 optional refs：省略，不伪造。
- 缺失 trusted owner/time：按 LOG policy 输出 bounded system degradation 或 fail closed，不从当前 ALS / sink time 补齐。

## 代码修改方案

1. `packages/agent-observability/src/logging/structured-log-projector.ts`：改为 fixed projector，输入 `ObservabilityObservationEvent`，输出 `SurfaceProjectionResult`。
2. `packages/agent-observability/src/logging/logger.ts`：保留为 transport wrapper；不作为业务 package API。
3. `packages/agent-app/src/composition/create-app.ts`：移除 request hook / system observation / terminal path 中的直接 projector 或 logger 调用，统一走 `acceptObservation(event)`。
4. `packages/agent-observability/src/linking/projector-host.ts`：fixed projector set 中包含 `StructuredLogProjector`。
5. tests：覆盖 coverage 清单、redaction、duration/usage、缺失 refs、省略 raw payload、transport failure、无直接 logger import。

## 验收样例

- `MODEL_INVOCATION_COMPLETED` observation 带 `durationMs` 和 `usage` 时，日志输出 `costLatency.durationMs` 和 `costUsage.inputTokens/outputTokens/totalTokens`。
- `CAPABILITY_COMPLETED` observation 不输出 tool args/result。
- 后续 gateway wrapper observation 输出 `gateway.call` 日志时，不包含 path、SQL、credential 或 raw error。
- system observation 输出 `system.runtime`，不携带 request lifecycle status。
- transport failure 不阻塞 terminal commit，并产生 bounded logging degradation evidence。
