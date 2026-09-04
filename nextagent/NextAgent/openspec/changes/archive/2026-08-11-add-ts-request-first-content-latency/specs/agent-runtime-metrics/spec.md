## Function

- **所属 Function**：`FN-7.5 采集指标`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Metric inventory 必须声明来源、标签和增强需求

METRIC surface SHALL 维护 stable inventory。每个 metric SHALL 声明 type、value、allowed labels、preferred input、fallback input、dedup key 和 event enhancement requirements。

首版 inventory SHALL 包含：

| Metric | Type | Labels | Preferred input | Fallback input |
|---|---|---|---|---|
| `web_request_total` | counter | `entrypoint`, `status_family` | channel entrypoint middleware observation | none |
| `web_request_duration_seconds` | histogram | `entrypoint`, `status_family` | channel entrypoint middleware observation | none |
| `request_outcome_total` | counter | `status` | terminal timeline observation | none |
| `request_duration_seconds` | histogram | `status` | terminal observation with duration candidate | runtime terminal wrapper if event lacks duration |
| `request_phase_duration_seconds` | histogram | `phase`, `status` | runtime lifecycle observation | runtime lifecycle wrapper |
| `request_first_content_latency_seconds` | histogram | `outcome` | `REQUEST_FIRST_CONTENT_DELIVERED` timeline-derived observation | none |
| `model_invocation_total` | counter | `outcome` | `ModelInvocationService` wrapper observation | none |
| `model_invocation_duration_seconds` | histogram | `outcome` | model wrapper observation with `durationMs` | none |
| `model_token_usage_total` | counter | `token_type`, `outcome` | model wrapper observation with `usage` | none |
| `model_ttft_seconds` | histogram | `outcome` | normalized visible stream observation | normalized stream wrapper |
| `model_chunk_latency_seconds` | histogram | none | normalized visible stream observation | normalized stream wrapper |
| `model_total_latency_seconds` | histogram | `outcome` | normalized terminal stream observation | normalized stream wrapper |
| `capability_invocation_total` | counter | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` observation | capability wrapper |
| `capability_invocation_duration_seconds` | histogram | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` with `durationMs` | capability wrapper |
| `gateway_call_total` | counter | `gateway_category`, `outcome` | gateway authoritative observation | `GatewayPort` wrapper |
| `gateway_call_duration_seconds` | histogram | `gateway_category`, `outcome` | gateway authoritative observation | `GatewayPort` wrapper |
| `observability_degradation_total` | counter | `surface`, `reason_code` | shared degradation observation | none |
| `projector_projection_total` | counter | `surface`, `result` | projector host outcome observation | none |

model metrics MUST NOT 使用 `modelId`、`providerId`、provider implementation class 或等价 provider category label。模型 identity 和 provider binding 的变化 MUST NOT 改变同一 outcome/usage/timing fact 的 metric name、value、dedup 或 emission behavior。

Metric acquisition MUST NOT 要求新增 `TimelineEventType`。Model invocation 的 duration / usage MUST 来自 `ModelInvocationService` wrapper observation；`CAPABILITY_COMPLETED` 的 duration 增强 MUST 来自统一 observation lifecycle。request、model、capability、HTTP、observability degradation、projector outcome、normalized stream timing 和 generic gateway fallback measurements MUST 进入同一 observation stream。

**需求类别**：功能性需求

#### Scenario: Model end event 输出 usage metrics
- **WHEN** `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED` observation 携带 normalized `usage`
- **THEN** `model_token_usage_total` MUST 对每个 present token field 写一个 sample
- **AND** 缺失 usage 字段 MUST 省略，不补 `0`、不估算
- **AND** sample labels MUST 只包含 `token_type` 与 `outcome`

#### Scenario: 模型指标不按 provider 分组
- **WHEN** 两次模型调用使用不同 `modelId` 或 `providerId` 但产生相同 outcome
- **THEN** model metric samples MUST 使用相同 label schema
- **AND** metrics MUST NOT 根据 provider identity 推断或生成 category label

#### Scenario: Capability metrics 不读取 result payload
- **WHEN** `CAPABILITY_COMPLETED` observation 被投影
- **THEN** capability metrics MUST 只使用 status、capability kind、outcome 和 duration
- **AND** MUST NOT 读取 tool args 或 result payload

#### Scenario: Request first content latency 使用 timeline-derived observation
- **WHEN** `REQUEST_FIRST_CONTENT_DELIVERED` observation 携带 `durationMs`
- **THEN** `request_first_content_latency_seconds` MUST 写一个 histogram sample
- **AND** sample labels MUST 只包含 `outcome=success`
- **AND** 缺失 `durationMs` 时 MUST 省略 sample

## ADDED Requirements

### Requirement: Request 首个内容交付时延必须从 request accepted 测量到首个可见内容

`TimelineObservationMapper` MUST 在首次 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` per run 时产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation，以先到达的事件类型触发。该 observation 的 `durationMs` MUST 等于首个触发的 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` 的 `createdAt` 减去同 run 的 `REQUEST_ACCEPTED` 的 `createdAt`。该 observation 的 `boundary` MUST 为 `request_lifecycle`，`outcome` MUST 为 `success`。

同一 run 的后续 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` MUST NOT 产出额外的 `REQUEST_FIRST_CONTENT_DELIVERED` observation。多轮 agent loop 中只有第一轮的首次内容事件（content 或 thinking）触发该 observation。

如果 `REQUEST_ACCEPTED` 的 `acceptedAt` 未被 mapper 记录（例如 replay 或 mapper 初始化后未处理该 run 的 accepted event），`LLM_CONTENT_DELTA` 和 `LLM_THINKING_DELTA` MUST NOT 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation。

如果 run 在任何 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` 产生前终止，`REQUEST_FIRST_CONTENT_DELIVERED` observation MUST NOT 产出，`request_first_content_latency_seconds` metric MUST NOT 写 sample。

terminal event MUST 清理 `firstContentDeliveredByRun` 中该 runId 的状态，与现有 `clearRunState` 清理 `modelStartedAtByInvocation` 和 `firstVisibleByInvocation` 的语义一致。

该 observation MUST NOT 使用 prompt、content text、provider raw delta、model output 或高基数字段。`durationMs` 是唯一测量值；stable refs 只使用 `runId`、`requestId`、`sessionId` 和 `timelineEventId`。

该 observation 的产出 MUST NOT 阻断 timeline event 处理或改变 request lifecycle 结果，与现有 timeline observation 的 non-blocking 语义一致。`durationMs` MUST 为非负数（`Math.max(0, ...)`）。`MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation（per-invocation）MUST 只在 `LLM_CONTENT_DELTA` 时产出，MUST NOT 在 `LLM_THINKING_DELTA` 时产出。

**需求类别**：功能性需求

#### Scenario: 首个 LLM_CONTENT_DELTA 产出 observation
- **WHEN** mapper 处理某 run 的首个 `LLM_CONTENT_DELTA`，且该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理，且此前未产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **THEN** MUST 产出恰好一个 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** `durationMs` MUST 等于 `LLM_CONTENT_DELTA.createdAt - REQUEST_ACCEPTED.createdAt`
- **AND** `boundary` MUST 为 `request_lifecycle`
- **AND** `outcome` MUST 为 `success`

#### Scenario: 首个 LLM_THINKING_DELTA 产出 observation
- **WHEN** mapper 处理某 run 的首个 `LLM_THINKING_DELTA`，且该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理，且此前未产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **THEN** MUST 产出恰好一个 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** `durationMs` MUST 等于 `LLM_THINKING_DELTA.createdAt - REQUEST_ACCEPTED.createdAt`
- **AND** `boundary` MUST 为 `request_lifecycle`
- **AND** `outcome` MUST 为 `success`
- **AND** MUST NOT 产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation

#### Scenario: LLM_THINKING_DELTA 先到达后 LLM_CONTENT_DELTA 不重复产出
- **WHEN** mapper 已在某 run 的首个 `LLM_THINKING_DELTA` 时产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation，随后处理同 run 的首个 `LLM_CONTENT_DELTA`
- **THEN** MUST NOT 产出额外的 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** 该 `LLM_CONTENT_DELTA` 仍 MAY 产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation（per-invocation 逻辑独立于 per-run）

#### Scenario: 首个 LLM_CONTENT_DELTA 同时产出 per-invocation 和 per-run observation
- **WHEN** mapper 处理某 run 的首个 `LLM_CONTENT_DELTA`，该 `LLM_CONTENT_DELTA` 携带有效 `stepId`，且该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理，且此前未产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **THEN** mapper 返回的 observation 数组 MUST 同时包含 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`（per-invocation，duration = delta - modelStartedAt）和 `REQUEST_FIRST_CONTENT_DELIVERED`（per-run，duration = delta - acceptedAt）
- **AND** 两条 observation 的 `durationMs` 语义不同，MUST NOT 合并为一条

#### Scenario: stepId 缺失但 REQUEST_ACCEPTED 存在时仍产出 per-run observation
- **WHEN** mapper 处理某 run 的首个 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA`，该 delta 不携带 `stepId` 且 `activeModelStepByRun` 无对应记录，但该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理
- **THEN** MUST 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** MUST NOT 产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation（per-invocation 逻辑因 stepId 缺失而跳过）

#### Scenario: 后续 LLM_CONTENT_DELTA 不重复产出
- **WHEN** mapper 处理同 run 的第二个或后续 `LLM_CONTENT_DELTA`
- **THEN** MUST NOT 产出额外的 `REQUEST_FIRST_CONTENT_DELIVERED` observation

#### Scenario: 后续 LLM_THINKING_DELTA 不重复产出
- **WHEN** mapper 处理同 run 的第二个或后续 `LLM_THINKING_DELTA`
- **THEN** MUST NOT 产出额外的 `REQUEST_FIRST_CONTENT_DELIVERED` observation

#### Scenario: 多轮 agent loop 只产出一次
- **WHEN** 同一 run 的第二轮 model invocation 产出首个 `LLM_CONTENT_DELTA`
- **THEN** MUST NOT 产出额外的 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** 第一轮已产出的 observation 是该 run 唯一的 first-content observation

#### Scenario: REQUEST_ACCEPTED 缺失时跳过
- **WHEN** mapper 处理某 run 的首个 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA`，但该 run 的 `REQUEST_ACCEPTED` 未被 mapper 处理过
- **THEN** MUST NOT 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation

#### Scenario: Run 无内容交付时不产出
- **WHEN** run 终止时未产生任何 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA`
- **THEN** MUST NOT 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** `request_first_content_latency_seconds` MUST NOT 写 sample

#### Scenario: Terminal 清理 per-run 状态
- **WHEN** mapper 处理 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** `firstContentDeliveredByRun` MUST 删除该 runId 的状态

## Function 变更汇总

### 名称
- **变更类型**：不变
- **目标内容**：`FN-7.5 采集指标`
- **依据 Requirements**：无直接变更

### 规格
- **规格项**：metric inventory
- **变更类型**：MODIFIED
- **原规格值**：（见基线 inventory table，不含 `request_first_content_latency_seconds`）
- **目标规格值**：inventory 新增 `request_first_content_latency_seconds`（histogram, label `outcome: success`, preferred input `REQUEST_FIRST_CONTENT_DELIVERED` timeline-derived observation, fallback none）
- **依据 Requirements**：`Metric inventory 必须声明来源、标签和增强需求`、`Request 首个内容交付时延必须从 request accepted 测量到首个可见内容`
