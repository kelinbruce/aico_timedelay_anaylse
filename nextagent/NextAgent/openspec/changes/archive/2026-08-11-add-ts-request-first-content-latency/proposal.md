## 背景与问题

运维人员需要从黑盒视角定位"页面首字耗时"——从用户提交问题到页面实际收到第一条回答内容的端到端时延。这不是大模型内部的首字符耗时（已有 `model_ttft_seconds`），而是包含 request acceptance、调度排队、context assembly、模型调用启动和模型首字符的完整前置链路。

当前 metric 体系有 `model_ttft_seconds`（从 `MODEL_INVOCATION_STARTED` 到首个 `LLM_CONTENT_DELTA`，per model invocation）和 `request_duration_seconds`（从 request 开始到 terminal commit 的总耗时），但没有覆盖"从 `REQUEST_ACCEPTED` 到首个 `LLM_CONTENT_DELTA`"这一段的 metric 或 observation。运维人员无法通过单一指标定位页面首字时延，只能离线从两条日志的事件时间戳手动拼凑差值。

`TimelineObservationMapper` 已经维护 `acceptedAtByRun` map（在 `REQUEST_ACCEPTED` 时填充），且已有 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 的 per-invocation first-visible 模式可类比。本 change 在同一 mapper 中新增 per-run first-content observation，复用现有 timeline event 和 observation projector 体系。

## 目标效果

完成后，运维人员可以通过单一 metric `request_first_content_latency_seconds` 和对应结构化日志 `request.first_content_delivered` 直接观察页面首字时延。该指标覆盖从 `REQUEST_ACCEPTED` 到首个 `LLM_CONTENT_DELTA` 的完整前置链路，与 `model_ttft_seconds`（模型内部首字符）互补。多轮 agent loop 中只产出一次 sample（per run），不随每轮 model invocation 重复。

## 变更范围

- 在 `TimelineObservationMapper` 中新增 `REQUEST_FIRST_CONTENT_DELIVERED` observation，在首次 `LLM_CONTENT_DELTA` per run 时触发，duration 为 `REQUEST_ACCEPTED.createdAt` 到 `LLM_CONTENT_DELTA.createdAt` 的差值。
- 在 metric inventory 中新增 `request_first_content_latency_seconds` histogram，label 为 `outcome: success`。
- 在 `StructuredLogProjector` 中新增 `REQUEST_FIRST_CONTENT_DELIVERED` 到 `request.first_content_delivered` 的显式映射。
- 不新增 `TimelineEventType`；复用已有 `REQUEST_ACCEPTED` 和 `LLM_CONTENT_DELTA`。
- 不测量 HTTP 传输延迟和 SSE 推送延迟（channel 层不改动）。

## 非目标

- 不在 channel/transport 层测量 SSE 交付延迟或 HTTP 请求到达时间。
- 不新增 `REQUEST_NO_FIRST_CONTENT` observation 或 `no_first_content` outcome label；run 无内容交付时不产出 sample，与 `model_ttft_seconds` 的 no-first-token 跳过一致。
- 不改变 `model_ttft_seconds` 的语义或采样逻辑。
- 不改变 `request_phase_duration_seconds` 的 `queued`/`executing` phase 缺口。
- 不新增 OpenSpec capability 或 Function。

## Function 影响（OpenSpec Capabilities）

- `FN-7.5 采集指标`（`agent-runtime-metrics`）：MODIFIED。在 metric inventory 中新增 `request_first_content_latency_seconds`，并新增 requirement 约束其测量起点、终点、per-run once 语义和 no-sample 跳过行为。

## 被动影响

- `packages/agent-observability/src/trajectory/timeline-observation-mapper.ts`：新增 `firstContentDeliveredByRun` Set 和 `REQUEST_FIRST_CONTENT_DELIVERED` observation 生成逻辑；`TimelineObservationMapper` 返回类型从 `ObservabilityObservationEvent | undefined` 改为 `readonly ObservabilityObservationEvent[]`，以支持同一条 `LLM_CONTENT_DELTA` 同时产出 per-invocation `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 和 per-run `REQUEST_FIRST_CONTENT_DELIVERED` 两条 observation。
- `packages/agent-app/src/composition/request-runtime-composition.ts`：timeline event listener 中 mapper 消费逻辑从单值改为遍历数组。
- `packages/agent-observability/src/metrics/metric-descriptors.ts`：新增 `request_first_content_latency_seconds` descriptor。
- `packages/agent-observability/src/metrics/metrics-registry.ts`：新增 `REQUEST_FIRST_CONTENT_DELIVERED` 的 metric sample 生成分支。
- `packages/agent-observability/src/logging/structured-log-projector.ts`：新增 `REQUEST_FIRST_CONTENT_DELIVERED` 到 `request.first_content_delivered` 映射。
- `packages/agent-observability/tests/`：新增 timeline-observation-mapper、metrics-registry 和 structured-log-projector 的测试用例。
- `packages/agent-observability/tests/timeline-observation-mapper.test.ts`：现有直接调用 `mapper(...)` 的断言适配为数组返回。
