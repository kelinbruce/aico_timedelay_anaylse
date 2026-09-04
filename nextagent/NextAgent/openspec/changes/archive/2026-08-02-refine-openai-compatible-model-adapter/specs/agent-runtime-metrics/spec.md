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

### Requirement: Metric labels 必须低基数且固定

Metric labels SHALL 只使用 descriptor 声明的 keys 和 values。request id、run id、session id、message id、tenant id、subject id、path、prompt、content、raw provider name、raw endpoint、`modelId`、`providerId`、free-text reason、secret、credential、trace id/span id 或 dynamic payload MUST NOT 作为 labels。

首版 allowed label vocabularies SHALL 包含：

- `entrypoint`: `health_primary`, `health_deep`, `submit`, `stream`, `history`, `other`
- `status_family`: `2xx`, `3xx`, `4xx`, `5xx`
- `status`: `COMPLETED`, `FAILED`, `CANCELED`, `SUPERSEDED`
- `phase`: `accepted`, `queued`, `executing`, `terminal_commit`
- `capability_kind`: `TOOL`, `SKILL`, `AGENT`
- `gateway_category`: `local`, `remote`, `model_provider`, `content`
- `outcome`: `success`, `failure`, `timeout`, `canceled`, `denied`, `degraded`, `no_first_token`
- `token_type`: `input`, `output`, `total`
- `surface`: `LOG`, `AUDIT`, `METRIC`, `HEALTH`, `TRACE`
- `result`: `emitted`, `skipped_not_covered`, `skipped_policy_denied`, `degraded`, `failed_closed`

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: High-cardinality labels 被拒绝
- **WHEN** metric sample 尝试使用 `requestRunId`、`tenantId`、path、`modelId`、`providerId` 或 free-text reason 作为 label
- **THEN** sample MUST 被拒绝或降级
- **AND** 业务 outcome MUST 保持不变

#### Scenario: Provider category 不构成 metric label
- **WHEN** model observation 被投影为 model metrics
- **THEN** model metrics MUST 继续按 inventory 产生 samples
- **AND** 系统 MUST NOT 合成 `provider_kind=OTHER` 或其他替代 label
- **AND** `model_total_latency_seconds` sample MUST 只包含 `outcome`

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：model metric projection 消费不含 provider/model identity diagnostic 的标准模型 observation。
- **依据 Requirements**：`Metric inventory 必须声明来源、标签和增强需求`、`Metric labels 必须低基数且固定`

### 处理过程

- **变更类型**：修改
- **目标内容**：模型调用、duration、usage 和 stream timing 指标只按 outcome/token type 等固定低基数维度投影，不按模型或 provider 身份分类。
- **依据 Requirements**：`Metric inventory 必须声明来源、标签和增强需求`、`Metric labels 必须低基数且固定`

### 结果

- **变更类型**：修改
- **目标内容**：model metrics 保留既有 name/value/dedup 语义，并移除 `provider_kind` label。
- **依据 Requirements**：`Metric inventory 必须声明来源、标签和增强需求`
