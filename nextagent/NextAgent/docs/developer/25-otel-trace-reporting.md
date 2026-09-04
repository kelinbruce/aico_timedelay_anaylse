# OTEL Trace 事件与上报指南

本文说明 NextAgent 当前如何从 runtime timeline 和统一 observation stream 生成 OpenTelemetry Trace，面向二次开发、部署联调、Collector 接入和问题排查使用。本文只覆盖 Trace；Metrics 清单见 [Observability Metrics 指标清单](./22-observability-metrics.md)。

当前实现事实源：

- 权威执行 Span：`packages/agent-observability/src/linking/timeline-span-lifecycle.ts`
- 辅助诊断 Span：`packages/agent-observability/src/linking/trace-projector.ts`
- 统一 observation contract：`packages/agent-observability/src/linking/observation.ts`
- OTLP/HTTP exporter：`packages/agent-observability/src/linking/otel-trace-infrastructure.ts`
- 稳定行为契约：`openspec/specs/otel-trace-export/spec.md`、`openspec/specs/otel-observability-adapter/spec.md`

## 当前使用的 OTEL 数据模型

这里的“模型”指 OpenTelemetry 数据模型，不是 LLM。OTEL 本身不选择或调用任何 LLM，只观测 NextAgent 的 Model 调用；当前 Trace 投影还会有意排除 `modelId`、provider 等模型身份字段。

当前生产路径实际使用两类 OTEL signal，并使用 Context 作为关联与传播基础：

| 类别 | 当前使用的 OTEL 模型 | 状态与用途 |
|---|---|---|
| Trace | `Resource`、`InstrumentationScope`、`Span`、`SpanContext`、`SpanStatus`、`SpanAttribute`、`SpanEvent`、`SpanLink` | 已使用；表达权威执行区间、辅助诊断事实、父子关系和异步关联。 |
| Context propagation | W3C `traceparent`、`tracestate` | 已使用；接收入站 parent，并向受控出站调用传播 Trace Context。 |
| Metrics | `ResourceMetrics`、`MeterProvider`、`Meter`、`Counter`、`Histogram`、Attributes | 已使用；本报告只列模型范围，完整指标见 [Observability Metrics 指标清单](./22-observability-metrics.md)。 |
| Logs | `LogRecord`、OTLP Logs | 未使用；NextAgent structured log 不是 OTEL Logs signal。 |
| Baggage | OTEL Baggage | 未使用。 |
| Profiles | OTEL Profiles | 未使用。 |

Trace 模型的当前落点：

- `Resource` 只携带 `service.name` 和可选 `service.version`。
- `InstrumentationScope` 来自 tracer scope；权威执行 Span 使用 `nextagent-timeline-lifecycle`，辅助 Span 使用 `nextagent-observability`。
- `Span` 当前使用 `INTERNAL` 和 `CLIENT` 两种 `SpanKind`；自定义 Trace 路径不创建 `SERVER`、`PRODUCER` 或 `CONSUMER` Span。
- `SpanContext` 保存 `traceId`、`spanId`、trace flags 和可选 trace state，并用于父子关系与传播。
- `SpanStatus` 当前映射为 `OK` 或 `ERROR`。
- `SpanAttribute` 只承载允许的安全、低基数字段；`SpanEvent` 承载 `observability.authoritative_fact`；`SpanLink` 关联合法 `traceparent` 指向的异步上游上下文。
- Trace 远程导出使用 `NodeTracerProvider`、`BatchSpanProcessor` 和 OTLP Trace HTTP JSON exporter。

Metrics 当前只创建 `Counter` 和 `Histogram` instrument，使用累计 temporality；远程导出使用 OTLP Metrics Protobuf exporter，本地模式使用 `LocalMetricHistoryExporter`。当前没有创建 `Gauge`、`ObservableGauge` 或 `UpDownCounter`，也没有使用 Exemplar。

`@opentelemetry/propagator-b3` 虽然已声明为依赖，但当前生产代码没有接入 `B3Propagator`，因此不能把 B3 视为已启用传播模型。实际传播协议仍是 W3C Trace Context。`x-task-event-id` 是 NextAgent 自定义传播扩展，也不是 OTEL 数据模型。

## 上报链路

NextAgent 有两条 Trace 输入路径，二者不能互相替代：

```text
RunTimelineEventRecord
  │
  ├─ TimelineSpanLifecycle
  │    └─ request / model / tool / workflow_node 权威执行 Span
  │
  └─ timeline observation mapper
       └─ ObservabilityObservationEvent
            └─ TraceProjector
                 └─ allowlist 中的 request/system/gateway 辅助 Span

完成的 Span
  └─ BatchSpanProcessor
       └─ OTLPTraceExporter
            └─ OTLP/HTTP JSON ExportTraceServiceRequest
```

权威执行 Span 表达真实执行区间和父子关系。辅助 Span 表达被明确批准的诊断事实。不得为了增加 Trace 展示而给同一执行阶段同时创建两套 Span。

## 启用方式

System config 使用 `observability.tracing`：

```yaml
observability:
  tracing:
    endpoint: env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    authPkRef: env:OTEL_AUTH_PK
    authSkRef: env:OTEL_AUTH_SK
    serviceName: nextagent
```

配置语义：

| 配置 | 结果 |
|---|---|
| `enabled: false` | 关闭进程内 Trace、timeline enrichment、W3C 传播和远程 exporter。 |
| `enabled: true`，不配置 exporter 三项 | 启用进程内 Trace，不发送远程 OTLP。 |
| `enabled` 缺失，exporter 三项完整 | 自动启用 Trace 和远程 OTLP exporter。 |
| `enabled: true`，exporter 三项完整 | 启用进程内 Trace 和远程 OTLP exporter。 |
| exporter 三项只配置一项或两项 | 配置校验失败，不启动 exporter。 |

`endpoint`、`authPkRef`、`authSkRef` 必须全部存在或全部缺失。远程 exporter 使用 `@opentelemetry/exporter-trace-otlp-http` 的 HTTP JSON 协议；endpoint 应指向 Collector 或观测平台的 Trace 接收地址，通常以 `/v1/traces` 结尾。

Exporter 当前使用 `BatchSpanProcessor`：

- 批处理延迟：5 秒
- 单批最大 Span 数：8
- Resource 只包含 `service.name` 和可选 `service.version`
- Authorization 使用从 SecretReference 解析出的凭据，不把凭据写入日志、Trace 或 safe error

## 输入消息类型

### `RuntimeRunTimelineEventRecord`

Runtime timeline 是 request、model、capability 和 workflow node 执行事实的权威来源。关键字段如下：

```ts
interface RuntimeRunTimelineEventRecord {
  tenantId: TenantId;
  subjectId: SubjectId;
  agentId: AgentId;
  agentVersion: AgentVersion;
  eventId: string;
  sessionId: SessionId;
  runId: RequestRunId;
  requestId: MessageId;
  requestContextId: RequestContextId;
  sequence: TimelineSequence;
  type: TimelineEventType;
  inlinePayload: JsonObject;
  contentRef?: string;
  createdAt: EpochMillis;
}
```

`inlinePayload.trace` 只能由可信 `TimelineSpanLifecycle` 写入。调用方提交的同名字段会先被移除，不能注入 `traceId`、`spanId`、parent 或传播头。

### `ObservabilityObservationEvent`

辅助 Trace 与 LOG、AUDIT、METRIC、HEALTH 共用同一 observation carrier：

```ts
interface ObservabilityObservationEvent {
  spanOwner?: 'TIMELINE_LIFECYCLE';
  boundary:
    | 'request_lifecycle'
    | 'model_invocation'
    | 'capability_invocation'
    | 'gateway_call'
    | 'health_probe'
    | 'system';
  operation: string;
  outcome: 'success' | 'failure' | 'timeout' | 'canceled' | 'denied' | 'degraded';
  ownerScope: TrustedOwnerScope;
  occurredAt: EpochMillis;
  durationMs?: number;
  firstContentLatencyMs?: number;
  usage?: ObservationModelUsage;
  safeSummary?: string;
  safeReasonCode?: string;
  stableRefs?: StableObservationRefs;
  diagnosticSnapshot?: ObservabilityContext;
}
```

`spanOwner: 'TIMELINE_LIFECYCLE'` 表示权威 Span 已由 timeline owner 管理，`TraceProjector` 必须跳过，防止重复上报。

## 权威执行 Span 清单

| OTEL Span 名称 | 开始 timeline 消息 | 结束 timeline 消息 | 关联字段 | SpanKind | `nextagent.observation_type` |
|---|---|---|---|---|---|
| `nextagent.request` | `REQUEST_ACCEPTED` | `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` | `runId` | `INTERNAL` | `request` |
| `nextagent.model` | `MODEL_INVOCATION_STARTED` | `MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED` | `inlinePayload.stepId` | `CLIENT` | `model` |
| `nextagent.tool` | `CAPABILITY_STARTED` | `CAPABILITY_COMPLETED` | `inlinePayload.toolCallId` | `CLIENT` | `tool` |
| `nextagent.workflow_node` | `CAPABILITY_STARTED` | `CAPABILITY_COMPLETED` | `inlinePayload.nodeExecutionId` | `INTERNAL` | `workflow_node` |

配对规则：

- Request Span 使用有效入站 W3C parent；没有有效 parent 时创建 root Span。
- Model、Tool 和 Workflow Node Span 都是 Request Span 的直接子级。
- `nodeExecutionId` 优先于 `toolCallId`；存在前者时创建 Workflow Node Span。
- `nodeType=START` 或 `nodeType=END` 的 workflow 脚手架不创建独立 Span。
- Workflow handler 内部模型和 capability 调用复用当前 Workflow Node Span，不重复合成 model/tool Span。
- Request 终止时尚未结束的子 Span 会以 `REQUEST_TERMINATED` 失败关闭。
- Start timeline write 失败时，新建 Span 以 `TIMELINE_WRITE_FAILED` 失败关闭；Trace 失败不能覆盖原始 persistence 结果。

### 终态映射

| Timeline 终态 | `nextagent.outcome` | OTEL Status |
|---|---|---|
| `REQUEST_COMPLETED` | `success` | `OK` |
| `REQUEST_CANCELED`、`REQUEST_SUPERSEDED` | `canceled` | `ERROR` |
| `REQUEST_FAILED` | `failure` | `ERROR` |
| `MODEL_INVOCATION_COMPLETED` | `success` | `OK` |
| `MODEL_INVOCATION_FAILED` | `failure` | `ERROR` |
| `CAPABILITY_COMPLETED` 且 `status=SUCCEEDED` | `success` | `OK` |
| 其它 Capability terminal | `failure` | `ERROR` |

终态只投影已有的非负 `durationMs` 和安全 `safeErrorCode`/`reasonCode`；缺失值不估算、不补零。

## 辅助 Span allowlist

辅助 Span 统一使用 `SpanKind.INTERNAL`。除 `request_lifecycle` 外，system 和 gateway observation 必须通过 `stableRefs.requestRunId` 找到有效 Request Span；找不到时不上报，并返回 `REQUEST_TRACE_CONTEXT_UNAVAILABLE` 降级结果。

### Request lifecycle

| operation | OTEL Span 名称 |
|---|---|
| `REQUEST_REJECTED` | `request_lifecycle.REQUEST_REJECTED` |
| `TERMINAL_COMMITTED` | `request_lifecycle.TERMINAL_COMMITTED` |
| `TERMINAL_FAILED` | `request_lifecycle.TERMINAL_FAILED` |
| `REQUEST_CONTROL_REJECTED` | `request_lifecycle.REQUEST_CONTROL_REJECTED` |
| `PENDING_INPUT_REJECTED` | `request_lifecycle.PENDING_INPUT_REJECTED` |
| `POLICY_APPLIED` | `request_lifecycle.POLICY_APPLIED` |

Timeline mapper 产生的 `REQUEST_ACCEPTED` 和 `TERMINAL_COMMITTED` observation 带有 `spanOwner: 'TIMELINE_LIFECYCLE'`，不会再创建辅助 Span。Request 权威执行事实由 `nextagent.request` 表达。

### System

| operation | `langfuse.observation.type` |
|---|---|
| `HOOK_INVOKED`、`HOOK_COMPLETED`、`HOOK_FAILED` | `span` |
| `POLICY_EVALUATED`、`POLICY_ALLOWED`、`POLICY_DENIED`、`POLICY_FAILED` | `guardrail` |
| `ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED` | `span` |
| `ROUTING_DECISION`、`SAFE_ERROR_EMITTED` | `span` |
| `APP_SHUTDOWN` | `span` |
| `MEMORY_CONFIG_EVALUATED`、`MEMORY_DESCRIPTION_OVERRIDE_EVALUATED` | `span` |
| 以 `LANE_DRAIN_` 开头的 operation | `span` |
| 以 `RECOVERY_SCAN_` 开头的 operation | `span` |

`APP_SHUTDOWN` 和 memory configuration observation 虽在 allowlist 中，但其当前 producer 通常没有 request parent，因此通常只得到安全降级结果，不会实际发送 Span。开发者不能仅凭 operation 位于 allowlist 就认定远程平台必然能收到它。

### Gateway

| operation | OTEL Span 名称 |
|---|---|
| `SANDBOX_EXECUTION_STARTED` | `gateway_call.SANDBOX_EXECUTION_STARTED` |
| `SANDBOX_EXECUTION_COMPLETED` | `gateway_call.SANDBOX_EXECUTION_COMPLETED` |
| `SANDBOX_EXECUTION_FAILED` | `gateway_call.SANDBOX_EXECUTION_FAILED` |
| `SANDBOX_EXECUTION_DENIED` | `gateway_call.SANDBOX_EXECUTION_DENIED` |
| `SANDBOX_EXECUTION_TIMED_OUT` | `gateway_call.SANDBOX_EXECUTION_TIMED_OUT` |

Gateway 辅助 Span 表示 NextAgent 内部诊断阶段，不表示物理入站 server 或出站 client 请求，因此使用 `INTERNAL`，也不能成为出站传播父级。

## 当前不生成 Trace Span 的事件

下列事件可以进入 LOG、AUDIT、METRIC 或 HEALTH，但当前不在 TraceProjector allowlist 中，也不单独创建权威执行 Span：

- `TASK_TRAJECTORY_BUILD`
- `MEMORY_AGING_CYCLE`
- `MEMORY_EXTRACTION_CYCLE`
- `MEMORY_AGING_LIFECYCLE`
- `MEMORY_EXTRACTION_WRITE`
- `MEMORY_EXTRACTION_REJECTED`
- `CONTEXT_COMPACTED`
- `DEGRADATION_NOTICE`
- `USER_INPUT_REQUIRED`
- `USER_INPUT_RECEIVED`
- `USER_INPUT_TIMEOUT`
- `USER_INPUT_CANCELED`
- `BACKGROUND_TASK_STARTED`
- `BACKGROUND_TASK_COMPLETED`
- `BACKGROUND_TASK_FAILED`
- `MODEL_STREAM_FIRST_VISIBLE_CONTENT`
- `REQUEST_FIRST_CONTENT_DELIVERED`
- `LLM_THINKING_DELTA`
- `LLM_CONTENT_DELTA`
- `CAPABILITY_RESULT_DELTA`
- `TOOL_STRUCTURED_DELTA`

特别地，TaskTrajectory 和 LongTermMemory 不是 OTEL message。记忆链路和 Trace 链路只共享可信运行事实，不执行 `TaskTrajectoryRecord -> OTEL` 转换。

## 字段转换

### 权威执行 Span

| 来源 | OTEL 字段或属性 |
|---|---|
| 执行种类 | Span name、SpanKind、`nextagent.observation_type`、`nextagent.execution.kind` |
| timeline `createdAt` | `startTimeUnixNano` 或 `endTimeUnixNano` |
| terminal outcome | `nextagent.outcome`、OTEL Status |
| terminal `durationMs` | `nextagent.duration_ms` |
| `safeErrorCode` / `reasonCode` | `nextagent.reason_code`、错误 Status message |
| 可信 task event ID | `eventId` |
| Workflow node `nodeId` | `nodeId` |
| Workflow node `description` / `nodeDesc` | `description` |

### 辅助 Span

| Observation 字段 | OTEL 字段或属性 |
|---|---|
| `boundary` | Span name 前缀、`nextagent.boundary` |
| `operation` | Span name 后缀、`nextagent.operation` |
| `outcome` | `nextagent.outcome`、OTEL Status |
| `ownerScope.agentId` | `nextagent.owner.agent_id` |
| `ownerScope.agentVersion` | `nextagent.owner.agent_version` |
| `ownerScope.subjectId` | `user.id` |
| `stableRefs.sessionId` | `session.id` |
| `safeReasonCode` | `nextagent.reason_code` |
| `durationMs` | `nextagent.duration_ms` |
| `usage.*Tokens` | `nextagent.usage.input_tokens`、`output_tokens`、`total_tokens` |
| 允许的低基数 diagnostic candidate | `nextagent.diag.<key>` |

每个辅助 Span 还包含一个名为 `observability.authoritative_fact` 的 Span Event，只携带 `nextagent.outcome` 和可选 `nextagent.reason_code`。

`traceparent` 不作为普通 attribute 输出；合法值被解析为 Span Link。`tracestate`、高基数字段、敏感字段、数组值和不符合 allowlist 的 diagnostic candidate 不进入 Trace。

## 消息示例

### Timeline 开始与终态

Request 开始：

```json
{
  "type": "REQUEST_ACCEPTED",
  "runId": "run-001",
  "sessionId": "session-001",
  "requestId": "request-001",
  "createdAt": 1755500000000,
  "inlinePayload": {
    "attributes": {
      "eventId": "task-01"
    }
  }
}
```

Request 终态：

```json
{
  "type": "REQUEST_COMPLETED",
  "runId": "run-001",
  "sessionId": "session-001",
  "requestId": "request-001",
  "createdAt": 1755500001234,
  "inlinePayload": {
    "durationMs": 1234
  }
}
```

二者配对后生成：

```json
{
  "name": "nextagent.request",
  "kind": "INTERNAL",
  "startTime": 1755500000000,
  "endTime": 1755500001234,
  "status": "OK",
  "attributes": {
    "nextagent.observation_type": "request",
    "nextagent.execution.kind": "REQUEST",
    "eventId": "task-01",
    "nextagent.outcome": "success",
    "nextagent.duration_ms": 1234
  }
}
```

### 辅助 observation

```json
{
  "boundary": "system",
  "operation": "HOOK_INVOKED",
  "outcome": "success",
  "ownerScope": {
    "tenantId": "tenant-1",
    "subjectId": "subject-1",
    "agentId": "agent-1",
    "agentVersion": "v1"
  },
  "occurredAt": 1755500000500,
  "durationMs": 25,
  "safeReasonCode": "HOOK_COMPLETED",
  "stableRefs": {
    "sessionId": "session-001",
    "requestRunId": "run-001"
  },
  "diagnosticSnapshot": {
    "diagnosticCandidates": [
      {
        "key": "status",
        "value": "SUCCESS",
        "classification": "LOW_CARDINALITY",
        "cardinality": "LOW"
      }
    ]
  }
}
```

对应辅助 Span：

```json
{
  "name": "system.HOOK_INVOKED",
  "parentSpanId": "<nextagent.request spanId>",
  "kind": "INTERNAL",
  "attributes": {
    "nextagent.boundary": "system",
    "langfuse.observation.type": "span",
    "nextagent.operation": "HOOK_INVOKED",
    "nextagent.outcome": "success",
    "nextagent.owner.agent_id": "agent-1",
    "nextagent.owner.agent_version": "v1",
    "session.id": "session-001",
    "user.id": "subject-1",
    "nextagent.reason_code": "HOOK_COMPLETED",
    "nextagent.duration_ms": 25,
    "nextagent.diag.status": "SUCCESS"
  },
  "events": [
    {
      "name": "observability.authoritative_fact",
      "attributes": {
        "nextagent.outcome": "success",
        "nextagent.reason_code": "HOOK_COMPLETED"
      }
    }
  ]
}
```

### OTLP/HTTP JSON envelope

实际远程消息类型是 OTLP `ExportTraceServiceRequest`：

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          {
            "key": "service.name",
            "value": { "stringValue": "nextagent" }
          },
          {
            "key": "service.version",
            "value": { "stringValue": "1.2.3" }
          }
        ],
        "droppedAttributesCount": 0
      },
      "scopeSpans": [
        {
          "scope": {
            "name": "nextagent-timeline-lifecycle"
          },
          "spans": [
            {
              "traceId": "4dee0c6b7cd1a013a82c1532da5d881d",
              "spanId": "40984d6238cdbfb7",
              "name": "nextagent.request",
              "kind": 1,
              "startTimeUnixNano": "1755500000000000000",
              "endTimeUnixNano": "1755500001234000000",
              "attributes": [
                {
                  "key": "nextagent.observation_type",
                  "value": { "stringValue": "request" }
                },
                {
                  "key": "nextagent.execution.kind",
                  "value": { "stringValue": "REQUEST" }
                },
                {
                  "key": "nextagent.outcome",
                  "value": { "stringValue": "success" }
                },
                {
                  "key": "nextagent.duration_ms",
                  "value": { "intValue": 1234 }
                }
              ],
              "events": [],
              "status": { "code": 1 },
              "links": [],
              "flags": 257
            }
          ]
        }
      ]
    }
  ]
}
```

OTLP JSON 中 `kind=1` 表示 `INTERNAL`，`kind=2` 表示 `CLIENT`；`status.code=1` 表示 `OK`，`status.code=2` 表示 `ERROR`。时间使用 Unix 纳秒字符串。

## 新增或修改 Trace 事件

新增 Web API、stream event、runtime command、context/capability/gateway contract、安全边界或可观测信号前，必须先有 OpenSpec change。实施时按以下顺序检查：

1. 明确事件表达的是否是真实执行区间。
   - 是：由 timeline owner 建模 START/TERMINAL 配对，复用 `TimelineSpanLifecycle`。
   - 否：判断它是否是确有远程诊断价值的低基数辅助事实。
2. 只使用统一 `ObservabilityObservationEvent`，不得新增 Trace 专用 event bus、carrier 或 direct exporter write。
3. 为每个 operation 明确唯一 owner、boundary、低基数名称、outcome、parent 规则和缺失 parent 的行为。
4. 辅助事件如需进入 Trace，在 `TraceProjector` 明确加入 allowlist；不得使用无限制通配 operation。
5. 只投影安全、低基数 attribute。不得上报 prompt、模型输出、stream delta、Tool 输入输出、路径、附件内容、provider raw error、credential、token、tenantId、request/run/message ID 或任意动态 payload。
6. 不得从调用方 observation 接受 `traceId`、`spanId` 或 parent。执行关联只来自可信 timeline registry 或合法 W3C carrier。
7. 防止重复 Span：timeline-owned observation 必须带 `spanOwner: 'TIMELINE_LIFECYCLE'`，`TraceProjector` 必须跳过。
8. 补充正向和负向测试，实际断言允许事件被导出、禁止事件不被导出、缺少 parent 安全降级、敏感字段不进入 attribute/link/event。

建议的针对性验证：

```powershell
npx vitest run --config vitest.config.release.ts `
  packages/agent-observability/tests/timeline-span-lifecycle.test.ts `
  packages/agent-observability/tests/trace-projector.test.ts `
  packages/agent-observability/tests/trace-projector-negative.test.ts

npx vitest run --config vitest.config.release.ts `
  packages/agent-app/tests/otel-observability-adapter.test.ts

npm run lint:architecture
openspec validate --all --strict
```

涉及真实 runtime lifecycle、传播、并发、取消、terminal commit 或安全边界时，还必须运行相应 characterization、contract 和 architecture tests，不能只依赖 TraceProjector 单元测试。

## 排查

### Collector 收不到任何 Span

依次检查：

1. resolved tracing 是否启用。
2. endpoint、authPkRef、authSkRef 是否三项完整且 SecretReference 可解析。
3. operational log 是否出现 `otel.trace.init.completed`；若出现 `otel.trace.init.skipped`，根据 `safeReasonCode` 检查配置。
4. 是否只启用了进程内 Trace、没有配置 exporter。
5. 是否等待超过 5 秒 batch delay，或在关闭前执行了 bounded flush。
6. Collector endpoint 是否包含正确 Trace 路径。

### 某个 system/gateway event 没有 Span

检查：

1. operation 是否在 `TraceProjector` allowlist。
2. observation 是否携带 `stableRefs.requestRunId`。
3. 对应 Request Span 是否仍在 timeline registry 中。
4. projector result 是否为 `REQUEST_TRACE_CONTEXT_UNAVAILABLE`、`skipped_not_covered` 或 `PROJECTOR_FAILED`。
5. observation 是否带有 `spanOwner: 'TIMELINE_LIFECYCLE'`，因此被有意跳过。

### Span 存在但缺少某个属性

这是允许的安全行为。检查字段是否：

- 被标记为高基数或敏感；
- 命中 banned key；
- 不属于低基数 diagnostic candidate；
- 是数组或非 string/number/boolean scalar；
- 属于 model/provider identity；
- 缺失于 authoritative terminal fact，不能估算或补零。

不得通过放宽全局 redaction 或把原始 payload 改名的方式绕过投影策略。
