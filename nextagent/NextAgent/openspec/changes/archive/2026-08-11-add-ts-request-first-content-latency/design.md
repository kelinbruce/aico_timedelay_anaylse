## 设计范围

| Function | 目标变化 | delta specs | 设计章节 |
|---|---|---|---|
| `FN-7.5 采集指标` | 新增 `request_first_content_latency_seconds` metric 和 `REQUEST_FIRST_CONTENT_DELIVERED` observation | `specs/agent-runtime-metrics/spec.md` | 本 design 全文 |

## FN-7.5 采集指标

### 目标与规范依据

为运维人员提供黑盒视角的页面首字时延指标，覆盖从 `REQUEST_ACCEPTED` 到首个 `LLM_CONTENT_DELTA` 的完整前置链路。

本 Function 的目标 Requirements：
- canonical spec：`agent-runtime-metrics`
- MODIFIED `Metric inventory 必须声明来源、标签和增强需求`
- ADDED `Request 首个内容交付时延必须从 request accepted 测量到首个可见内容`

### 当前实现

`TimelineObservationMapper`（`packages/agent-observability/src/trajectory/timeline-observation-mapper.ts`）已经：

- 维护 `acceptedAtByRun: Map<string, number>`，在 `REQUEST_ACCEPTED` timeline event 时填充 `record.createdAt`。
- 维护 `modelStartedAtByInvocation: Map<string, number>`，在 `MODEL_INVOCATION_STARTED` 时填充。
- 维护 `firstVisibleByInvocation: Set<string>`，在首次 `LLM_CONTENT_DELTA` per model invocation 时产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation，duration 为 `record.createdAt - modelStartedAt`。
- 在 terminal event（`REQUEST_COMPLETED`/`FAILED`/`CANCELED`/`SUPERSEDED`）时通过 `clearRunState` 清理 per-invocation 状态，并通过 `acceptedAtByRun.delete(record.runId)` 清理 per-run accepted 时间。

`MetricsProjector`（`metrics-registry.ts`）已经：

- 在 `modelStreamSamples` 中将 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation 映射为 `model_ttft_seconds` histogram sample（`durationMs / 1000`，label `outcome=success`）。
- 在 `request_lifecycle` boundary 中将 `REQUEST_ACCEPTED` 映射为 `request_phase_duration_seconds`（phase=accepted, value=0）。

`StructuredLogProjector`（`structured-log-projector.ts`）已经：

- 将 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 显式映射为 `model.stream.first_visible_content`。
- 对未显式映射的 operation 使用 fallback：`event.operation.toLowerCase().replaceAll("_", ".")`。

`MetricDescriptor` inventory（`metric-descriptors.ts`）已包含 `request_outcome_total`、`request_duration_seconds`、`request_phase_duration_seconds`、`model_ttft_seconds` 等，但不包含 request 级别的首字时延 metric。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 产出 `request_first_content_latency_seconds` metric | 不存在 | 新增 descriptor 和 metric sample 生成分支 |
| 在首次 `LLM_CONTENT_DELTA` per run 时产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation | `LLM_CONTENT_DELTA` handler 只产出 per-invocation `MODEL_STREAM_FIRST_VISIBLE_CONTENT`，不产出 per-run observation | 新增 `firstContentDeliveredByRun` Set 和 observation 生成逻辑 |
| `REQUEST_FIRST_CONTENT_DELIVERED` 映射为 `request.first_content_delivered` 结构化日志 | fallback 映射可工作但无显式映射 | 新增显式映射 |
| per-run once：多轮 agent loop 只产出一次 | per-invocation `firstVisibleByInvocation` 是 per model invocation，不是 per run | 新增 `firstContentDeliveredByRun` 以 runId 为 key |
| run 无内容时不产出 sample | 无相关逻辑 | 不新增 observation 即不产出 sample，与 TTFT no-first-token 跳过一致 |

### 修改方案

**1. `timeline-observation-mapper.ts`**

**返回类型变更（前置条件）**：当前 `TimelineObservationMapper` 返回 `ObservabilityObservationEvent | undefined`（单值）。首个 `LLM_CONTENT_DELTA` per run 既要产出 per-invocation `MODEL_STREAM_FIRST_VISIBLE_CONTENT`（已有，duration = delta - modelStarted），又要产出 per-run `REQUEST_FIRST_CONTENT_DELIVERED`（新增，duration = delta - acceptedAt）。两条 observation 的 duration 语义不同（model TTFT vs request first content），不能合并为一条。因此必须将返回类型改为 `readonly ObservabilityObservationEvent[]`。

- `TimelineObservationMapper` 类型从 `(record) => ObservabilityObservationEvent | undefined` 改为 `(record) => readonly ObservabilityObservationEvent[]`。
- mapper 内部所有 `return timelineObservationFromRecord(record)` 改为 `const obs = timelineObservationFromRecord(record); return obs === undefined ? [] : [obs];`（或等价写法）。
- 所有 `return undefined` 改为 `return []`。
- `return modelFirstVisibleObservation(...)` 改为收集到数组中返回。

消费方 `request-runtime-composition.ts` 的 listener 从 `if (observation !== undefined) acceptObservation(observation)` 改为 `for (const observation of observations) acceptObservation(observation)`。

现有测试 `timeline-observation-mapper.test.ts` 中直接调用 `mapper(record(...))` 的断言需适配数组返回：`expect(mapper(...)[0]).toMatchObject(...)` 或 `expect(mapper(...)).toEqual([expect.objectContaining({...})])`。直接调用 `timelineObservationFromRecord` 的断言不受影响（该函数返回类型不变）。

在 `createTimelineObservationMapper` 闭包中新增 `firstContentDeliveredByRun: Set<string>`。

在 `LLM_CONTENT_DELTA` handler 中，per-run first-content 检查必须放在 `stepId === undefined` early return（当前 line 57）**之前**。原因：当 `LLM_CONTENT_DELTA` 不携带 `stepId` 且 `activeModelStepByRun` 无对应记录时（replay / partial-replay 场景），early return 会跳过 per-run 逻辑，导致首个内容交付 observation 丢失。per-run 检查只依赖 `acceptedAtByRun` 和 `firstContentDeliveredByRun`，不依赖 `stepId`，因此放在 early return 之前是安全的。

- 如果 `firstContentDeliveredByRun` 已包含 `record.runId`，跳过（后续轮次的 content delta 不重复产出）。
- 如果 `acceptedAtByRun` 未包含 `record.runId`（`REQUEST_ACCEPTED` 未被 mapper 处理过，例如 replay 场景），跳过。
- 否则，将 `record.runId` 加入 `firstContentDeliveredByRun`，产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation：
  - `boundary: "request_lifecycle"`
  - `operation: "REQUEST_FIRST_CONTENT_DELIVERED"`
  - `outcome: "success"`
  - `occurredAt: record.createdAt`
  - `durationMs: Math.max(0, Number(record.createdAt) - acceptedAt)`
  - `safeSummary: "Request reached first content delivery."`
  - `stableRefs: baseRefs(record)`
  - `diagnosticSnapshot: timelineDiagnosticSnapshot(record, [...persistenceCandidate(record)])`

per-run observation 产出后，继续执行现有 per-invocation `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 逻辑（stepId 读取、firstVisibleByInvocation 检查、modelFirstVisibleObservation 产出）。两条 observation 收集到同一个返回数组中。如果 `stepId === undefined`（early return 原先返回 `undefined`，现在返回 `[]` 或仅包含 per-run observation 的数组），per-invocation observation 不产出，但 per-run observation 已在前面产出。

在 terminal event handler 的 `clearRunState` 调用处，同步清理 `firstContentDeliveredByRun`。`clearRunState` 签名需新增 `firstContentDelivered: Set<string>` 参数，或改用独立清理函数。考虑到 `clearRunState` 已有 4 个参数且本 change 只新增一个 Set，在 `clearRunState` 内追加 `firstContentDelivered.delete(runId)` 调用是最小 delta。

**2. `metric-descriptors.ts`**

在 `MetricName` union type 中新增 `"request_first_content_latency_seconds"`。

在 `METRIC_DESCRIPTORS` 中新增：

```ts
request_first_content_latency_seconds: descriptor(
  "request_first_content_latency_seconds",
  "histogram",
  "s",
  { outcome: ["success"] },
  "duration_seconds",
  "timeline"
),
```

**3. `metrics-registry.ts`**

在 `metricSamplesForObservation` 中新增分支：

```ts
if (event.boundary === "request_lifecycle"
    && event.operation === "REQUEST_FIRST_CONTENT_DELIVERED"
    && event.durationMs !== undefined) {
  return [withMetricIdentity(event, {
    name: "request_first_content_latency_seconds",
    kind: "histogram",
    value: event.durationMs / 1000,
    labels: { outcome: "success" }
  })];
}
```

放在现有 `request_lifecycle` 的 `REQUEST_ACCEPTED` 分支之后，`TERMINAL_COMMITTED` 分支之前。

**4. `structured-log-projector.ts`**

在 `mapEvent` 中新增显式映射：

```ts
if (event.operation === "REQUEST_FIRST_CONTENT_DELIVERED") {
  return "request.first_content_delivered";
}
```

放在 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 映射之后。`levelFor` 默认对 success outcome 返回 `info`，无需额外处理。

**不修改的边界：**

- 不修改 trace projector：`covers` 对 `spanOwner === 'TIMELINE_LIFECYCLE'` 返回 `false`，`REQUEST_FIRST_CONTENT_DELIVERED` 不会被 trace 投影，与 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 一致。
- 不修改 audit projector：audit `covers` 只覆盖 `REQUEST_REJECTED`、`TERMINAL_COMMITTED`、`TERMINAL_FAILED` 和安全/凭证类 observation，`REQUEST_FIRST_CONTENT_DELIVERED` 不在覆盖范围内，与 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 一致。
- 不修改 health evaluator：health 是 probe-based，不是 observation projector。
- 不修改 `ObservabilityObservationEvent.operation` 类型：该字段是 `string`（自由字符串），不是 union，新增 operation 名称不需要类型变更。
- 不修改 `model_ttft_seconds` 的采样逻辑或 descriptor。
- 不修改 `request_phase_duration_seconds` 的 phase 采样。
- 不修改 channel/transport 层。
- 不新增 `TimelineEventType`。
- 不新增 `agent-contracts` 类型。
- 不修改 `structured-logging` spec 的 LOG coverage inventory：新增的 `request.first_content_delivered` log event 遵循与 `model.stream.first_visible_content` 相同的既有模式（derived observation 的 log 映射不进入 LOG coverage inventory 表，inventory 只声明 timeline event 或 wrapper observation 级别的 log event）。`structured-logging` spec 的 LOG coverage inventory 是否需要补全 derived observation 映射是既有的 spec compliance 缺口，不在本 change 范围内。

### 质量属性影响

无新增黑盒质量目标。本 change 只新增观测指标，不改变 request lifecycle、concurrency、cancellation、terminal commit 或 streaming 行为。metric 采样失败遵循现有 `Metrics failures 必须显式、有界且不影响业务结果` requirement。

### 验证策略

- spec 行为验证：timeline-observation-mapper 测试断言首次 `LLM_CONTENT_DELTA` per run 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation，后续 delta 不重复产出。
- 同时产出验证：timeline-observation-mapper 测试断言首个 `LLM_CONTENT_DELTA`（携带有效 stepId）的返回数组同时包含 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 和 `REQUEST_FIRST_CONTENT_DELIVERED`，且两者 durationMs 不同。
- stepId 缺失验证：timeline-observation-mapper 测试断言 stepId 缺失但 REQUEST_ACCEPTED 存在时仍产出 per-run observation，验证 per-run 检查在 stepId early return 之前执行。
- metric sample 验证：metrics-registry 测试断言 `REQUEST_FIRST_CONTENT_DELIVERED` observation 产出 `request_first_content_latency_seconds` sample。
- structured log 验证：structured-log-projector 测试断言映射为 `request.first_content_delivered`。
- 边界验证：`REQUEST_ACCEPTED` 缺失时不产出 observation；terminal 清理后同 runId 的新 delta 不产出 observation。
- negative case：run 无 `LLM_CONTENT_DELTA` 时不产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation 和 metric sample。

## 长期基线刷新计划

- `openspec/specs/agent-runtime-metrics/spec.md`：归档时合并 MODIFIED inventory requirement 和 ADDED first-content-latency requirement。
- 其他 stable spec、Function、Feature、architecture、module、ADR 和 spec-to-design-map：无。
