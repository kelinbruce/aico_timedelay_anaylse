## Function

- **所属 Function**：`FN-7.5 采集指标`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Metric inventory 必须声明来源、标签和增强需求

METRIC surface SHALL 维护 stable inventory。每个 metric SHALL 声明 type、value、allowed labels、preferred input、fallback input、dedup key 和 event enhancement requirements。

`FN-7.5` owning 的 inventory SHALL 包含：

| Metric | Type | Labels | Preferred input | Fallback input |
|---|---|---|---|---|
| `request_outcome_total` | counter | `status` | terminal timeline observation | none |
| `request_duration_seconds` | histogram | `status` | terminal observation with duration candidate | runtime terminal wrapper if event lacks duration |
| `request_phase_duration_seconds` | histogram | `phase`, `status` | runtime lifecycle observation | runtime lifecycle typed adapter |
| `request_first_content_latency_seconds` | histogram | `outcome` | `REQUEST_FIRST_CONTENT_DELIVERED` timeline-derived observation | none |
| `request_token_count` | histogram | `token_type`, `status` | terminal request aggregation | none |
| `request_active_concurrency` | histogram | none | runtime execution-state observation | none |
| `request_abnormal_termination_total` | counter | none | failed terminal timeline observation | none |
| `operation_timeout_total` | counter | `boundary` | authoritative operation terminal observation | none |
| `model_flow_control_total` | counter | none | terminal model rate-limit observation | none |
| `model_invocation_total` | counter | `outcome` | terminal model invocation observation | none |
| `model_invocation_duration_seconds` | histogram | `outcome` | terminal model invocation observation with `durationMs` | none |
| `model_token_usage_total` | counter | `token_type`, `outcome` | terminal model invocation observation with `usage` | none |
| `model_token_count` | histogram | `token_type`, `outcome` | terminal model invocation observation with `usage` | none |
| `model_output_token_rate` | histogram | `outcome` | terminal model invocation observation with output usage and stream timing | none |
| `model_ttft_seconds` | histogram | `outcome` | normalized visible stream observation | normalized stream wrapper |
| `model_chunk_latency_seconds` | histogram | none | normalized visible stream observation | normalized stream wrapper |
| `model_total_latency_seconds` | histogram | `outcome` | normalized terminal stream observation | normalized stream wrapper |
| `capability_invocation_total` | counter | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` observation | capability wrapper |
| `capability_invocation_duration_seconds` | histogram | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` with `durationMs` | capability wrapper |
| `gateway_call_total` | counter | `gateway_category`, `outcome` | gateway authoritative observation | `GatewayPort` wrapper |
| `gateway_call_duration_seconds` | histogram | `gateway_category`, `outcome` | gateway authoritative observation | `GatewayPort` wrapper |
| `observability_degradation_total` | counter | `surface`, `reason_code` | shared degradation observation | none |
| `projector_projection_total` | counter | `surface`, `result` | projector host outcome observation | none |

Official instrumentation 或其他 Function owning 的指标 SHALL 继续由各自 stable Requirement 定义，不得为把它们列入本 inventory 而创建重复 descriptor 或重复 sample。

model metrics MUST NOT 使用 `modelId`、`providerId`、provider implementation class 或等价 provider category label。模型 identity 和 provider binding 的变化 MUST NOT 改变同一 outcome、usage 或 timing fact 的 metric name、value、dedup 或 emission behavior。

Metric acquisition MUST NOT 要求新增 `TimelineEventType`。Model invocation 的 duration、usage、首字符时序和终态 MUST 来自同一模型调用的 canonical observation。request、model、capability、gateway、observability degradation、projector outcome 和 normalized stream timing MUST 进入同一 observation stream；运行时执行态的排队与并发事实 MUST 通过 narrow typed observation 进入该 stream，不得由日志反向推断。

**需求类别**：功能性需求

#### Scenario: Inventory 可回答目标统计
- **WHEN** 运维人员读取一个完成聚合的指标时间窗
- **THEN** inventory MUST 提供模型调用、模型时序、模型 token、对话、排队、并发、异常终止、超时和流控的对应指标
- **AND** 同一 stable fact MUST NOT 通过 preferred input 与 fallback input 重复计数

#### Scenario: 外部 owning 指标不被重复声明
- **WHEN** official instrumentation 或其他 Function 已定义一个指标
- **THEN** `FN-7.5` inventory MUST NOT 为该指标创建平行 descriptor 或重复 sample

#### Scenario: 模型指标不按 provider 分组
- **WHEN** 两次模型调用使用不同 `modelId` 或 `providerId` 但产生相同 outcome
- **THEN** model metric samples MUST 使用相同 label schema
- **AND** metrics MUST NOT 根据 provider identity 推断或生成 category label

## ADDED Requirements

### Requirement: 模型性能指标必须按终态调用提供次数、分布和生成速率

每个模型调用 MUST 仅在 `COMPLETED` 或 `FAILED` 终态为 `model_invocation_total` 产生恰好一个 sample；模型调用开始、stream 首内容、stream chunk 和 stream 终止 observation MUST NOT 增加该 counter。

当模型终态提供 `durationMs` 时，系统 MUST 为该调用记录 `model_invocation_duration_seconds`。当模型终态提供 `inputTokens` 或 `outputTokens` 时，系统 MUST 分别为 present 字段同时记录 `model_token_usage_total` counter 和 `model_token_count` histogram；缺失字段 MUST 省略，不得补 `0` 或估算。`model_token_count` 的 `token_type` MUST 只使用 `input` 或 `output`。

仅当同一模型终态同时提供 `outputTokens`、`durationMs` 和 `firstContentLatencyMs`，且 `durationMs > firstContentLatencyMs` 时，系统 MUST 记录一个 `model_output_token_rate` sample，其值 MUST 等于：

`outputTokens / ((durationMs - firstContentLatencyMs) / 1000)`，单位为 `{token}/s`。

条件不满足时系统 MUST 省略该速率 sample。`model_ttft_seconds`、`model_invocation_duration_seconds`、`model_token_count` 和 `model_output_token_rate` 的聚合 `sum / count` MUST 分别表示单次调用平均值，聚合 `max` MUST 表示单次调用最大值；`model_token_usage_total` MUST 表示 present token 字段的累计总数。

**需求类别**：功能性需求

#### Scenario: 成功模型调用只计一次并输出完整分布
- **WHEN** 一个模型调用先产生 started observation，后以 success 终态结束，并提供 `durationMs=2400`、`firstContentLatencyMs=400`、`inputTokens=120`、`outputTokens=80`
- **THEN** `model_invocation_total{outcome=success}` MUST 增加 `1`
- **AND** started observation MUST NOT 增加 `model_invocation_total`
- **AND** `model_token_count` MUST 分别记录 input `120` 和 output `80`
- **AND** `model_output_token_rate` MUST 记录 `40 {token}/s`

#### Scenario: 失败模型调用仍按终态计一次
- **WHEN** 一个模型调用以 failure、timeout、canceled、denied 或 degraded 终态结束
- **THEN** `model_invocation_total` MUST 按对应低基数 outcome 增加 `1`
- **AND** 同一调用的开始或 stream observations MUST NOT 产生第二次调用计数

#### Scenario: 缺失或无效速率输入时不推算
- **WHEN** 模型终态缺少 `outputTokens`、`durationMs` 或 `firstContentLatencyMs` 中任一字段，或者 `durationMs <= firstContentLatencyMs`
- **THEN** 系统 MUST NOT 记录 `model_output_token_rate`
- **AND** 其他已满足输入条件的模型指标 MUST 保持可记录

### Requirement: 对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布

一次对话 MUST 以一个 request run 的 terminal outcome 为唯一计数边界，并为 `request_outcome_total` 产生恰好一个 sample。`request_duration_seconds` MUST 测量 request accepted 到 terminal commit 的秒数。`request_first_content_latency_seconds` MUST 继续测量 request accepted 到首个用户可见内容或思考进入 canonical stream 的秒数，并且每个 request run 至多产生一个 sample。

`request_phase_duration_seconds{phase=queued}` MUST 测量 request accepted 到该 run 首次进入执行态的秒数；未进入执行态即到达终态的 run MUST 省略 queued sample，不得把终态时间当作执行态开始时间。

系统 MUST 在每个 request run 进入执行态或离开执行态后记录一个 `request_active_concurrency` sample，其值 MUST 等于该状态转换完成后当前 app runtime 实例中处于执行态的 request run 数量。一个聚合时间窗内，`sum / count` MUST 表示并发采样值的平均值，`max` MUST 表示最大并发采样值；该平均值是按执行态转换采样的算术平均值，不是时间加权平均值，也不是多 runtime 实例的集群全局并发值。

对话到达终态时，仅当该 run 的每个 terminal 模型调用都提供目标 token 字段且该 run 至少包含一个 terminal 模型调用，系统 MUST 分别汇总 `inputTokens` 和 `outputTokens`，并各产生一个 `request_token_count` sample。任一 terminal 模型调用缺失目标字段时，系统 MUST 省略该 run 对应 token type 的 sample，不得输出不完整汇总。`request_token_count` 的 `sum / count` MUST 表示对话级平均 token 数，`max` MUST 表示对话级最大 token 数，input 与 output token 各自的 `sum` MUST 表示对应 token type 的对话级累计总数。

**需求类别**：功能性需求

#### Scenario: 完成对话输出完整框架指标
- **WHEN** 一个 request run 排队 `250 ms` 后进入执行态，包含两个均提供 usage 的 terminal 模型调用，并最终 `COMPLETED`
- **THEN** `request_outcome_total{status=COMPLETED}` MUST 增加 `1`
- **AND** `request_phase_duration_seconds{phase=queued,status=success}` MUST 记录 `0.25 s`
- **AND** `request_token_count` MUST 分别记录两个模型调用 input token 之和与 output token 之和
- **AND** 该 run 的总耗时和存在时的界面首字响应时间 MUST 各记录至对应 histogram

#### Scenario: 并发按每次执行态转换采样
- **WHEN** 依次有两个 request run 进入执行态，随后依次离开执行态
- **THEN** `request_active_concurrency` MUST 依次记录 `1`、`2`、`1`、`0`
- **AND** 该样本序列的聚合平均值 MUST 为 `1`
- **AND** 聚合最大值 MUST 为 `2`

#### Scenario: 未执行的终态 run 不伪造排队时间
- **WHEN** 一个 request run 在首次进入执行态前到达终态
- **THEN** 该 run MUST 仍按其 terminal outcome 计入 `request_outcome_total`
- **AND** 系统 MUST NOT 为该 run 记录 queued duration 或执行态并发增加样本

#### Scenario: 不完整模型 usage 不形成对话级伪总数
- **WHEN** 一个 request run 的任一 terminal 模型调用缺少 `outputTokens`
- **THEN** 系统 MUST NOT 为该 run 记录 `request_token_count{token_type=output}`
- **AND** 若每个 terminal 模型调用都提供 `inputTokens`，input token sample MUST 保持可记录

### Requirement: 异常指标必须使用唯一权威终态分类

每个 `FAILED` request run MUST 为 `request_abnormal_termination_total` 产生恰好一个 sample；`COMPLETED`、`CANCELED` 和 `SUPERSEDED` request run MUST NOT 增加该 counter。

每个具有 authoritative timeout classification 的 request、model、capability 或 gateway operation terminal MUST 为 `operation_timeout_total` 产生恰好一个 sample，并使用 `boundary=request|model|capability|gateway` 中对应的唯一 label。request terminal 仅当 canonical safe error category 为 `TIMEOUT` 或 canonical safe error code 为 `PENDING_INPUT_TIMEOUT` 时具有 authoritative timeout classification；model、capability 和 gateway terminal 仅当 canonical observation `outcome=timeout` 时具有 authoritative timeout classification。非终态 observation、上层对下层 timeout 的重复转述以及只有 free-text 包含 timeout 的失败 MUST NOT 增加该 counter。

每个 terminal model invocation 的 canonical safe reason code 为 `MODEL_RATE_LIMITED` 时，系统 MUST 为 `model_flow_control_total` 产生恰好一个 sample；retry、fallback 或 request 最终成功 MUST NOT 抹除已成立的模型流控事实。同一模型调用的中间异常、日志文本或 HTTP 状态推断 MUST NOT 产生额外 sample。

**需求类别**：功能性需求

#### Scenario: 失败对话只产生一次异常终止计数
- **WHEN** 一个 request run 以 `FAILED` terminal outcome 结束
- **THEN** `request_abnormal_termination_total` MUST 增加 `1`
- **AND** 同一 run 的 model 或 capability failure MUST NOT 再增加该 counter

#### Scenario: 权威 timeout 按边界计数
- **WHEN** 一个 capability operation 以 authoritative `outcome=timeout` 终止
- **THEN** `operation_timeout_total{boundary=capability}` MUST 增加 `1`
- **AND** started observation 或 free-text error MUST NOT 增加该 counter

#### Scenario: 模型流控在 fallback 成功后仍保留
- **WHEN** 一个模型调用以 `MODEL_RATE_LIMITED` 终止，后续 fallback 模型调用成功
- **THEN** `model_flow_control_total` MUST 对前一个模型调用增加 `1`
- **AND** 后续成功调用 MUST NOT 抵消或重复该 sample

### Requirement: 非秒数直方图必须使用量纲匹配的固定聚合

`model_token_count` 和 `request_token_count` MUST 使用 unit `{token}` 与显式 boundaries `[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144]`。`model_output_token_rate` MUST 使用 unit `{token}/s` 与显式 boundaries `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]`。`request_active_concurrency` MUST 使用 unit `1` 与显式 boundaries `[0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]`。

全部 NextAgent-owned histogram MUST 记录 `count`、`sum`、`min` 和 `max`。local 与 remote exporter MUST 使用相同 unit、boundaries 和 aggregation semantics；sink/output 切换 MUST NOT 改变平均值、最大值或总数的计算口径。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 不同量纲使用各自固定桶
- **WHEN** metrics infrastructure 创建 token count、token rate、concurrency 和 seconds histogram instruments
- **THEN** 每个 instrument MUST 使用本 Requirement 或既有 seconds Requirement 为其量纲定义的唯一 boundaries
- **AND** 非秒数 histogram MUST NOT 使用 seconds boundaries

#### Scenario: Local 与 remote 聚合结果同义
- **WHEN** 同一组 metric samples 分别通过 local 与 remote exporter 输出
- **THEN** 两种输出的 histogram `count`、`sum`、`min`、`max` 与 bucket boundaries MUST 具有相同语义

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统采集安全、低基数的运行指标，完整覆盖模型调用性能、对话性能、排队与并发容量以及异常运行结果。
- **依据 Requirements**：`Metric inventory 必须声明来源、标签和增强需求`、`模型性能指标必须按终态调用提供次数、分布和生成速率`、`对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布`、`异常指标必须使用唯一权威终态分类`、`非秒数直方图必须使用量纲匹配的固定聚合`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按模型调用与对话的唯一终态采集次数和分布，按执行态转换采集排队与并发，按权威终态采集异常分类；缺失输入时省略对应样本且不推算。
- **依据 Requirements**：`模型性能指标必须按终态调用提供次数、分布和生成速率`、`对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布`、`异常指标必须使用唯一权威终态分类`

### 结果

- **变更类型**：修改
- **目标内容**：运维人员可从同一指标输出获得目标时间窗内模型和对话的次数、平均值、最大值、token 总数、排队与并发以及异常次数，且 local 与 remote 输出口径一致。
- **依据 Requirements**：`模型性能指标必须按终态调用提供次数、分布和生成速率`、`对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布`、`异常指标必须使用唯一权威终态分类`、`非秒数直方图必须使用量纲匹配的固定聚合`

### 规格

- **规格项**：运行指标清单
- **变更类型**：修改
- **原规格值**：`request_outcome_total`、`request_duration_seconds`、`request_phase_duration_seconds`、`request_first_content_latency_seconds`、`model_invocation_total`、`model_invocation_duration_seconds`、`model_token_usage_total`、`model_ttft_seconds`、`model_chunk_latency_seconds`、`model_total_latency_seconds`、`capability_invocation_total`、`capability_invocation_duration_seconds`、`gateway_call_total`、`gateway_call_duration_seconds`、`observability_degradation_total`、`projector_projection_total`
- **目标规格值**：在原清单基础上新增 `request_token_count`、`request_active_concurrency`、`request_abnormal_termination_total`、`operation_timeout_total`、`model_flow_control_total`、`model_token_count`、`model_output_token_rate`；模型调用次数只按 terminal invocation 计数
- **依据 Requirements**：`Metric inventory 必须声明来源、标签和增强需求`、`模型性能指标必须按终态调用提供次数、分布和生成速率`、`对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布`、`异常指标必须使用唯一权威终态分类`

- **规格项**：非秒数直方图聚合
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：token count 使用 `{token}` 与 `[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144]`；token rate 使用 `{token}/s` 与 `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]`；并发使用 `1` 与 `[0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]`
- **依据 Requirements**：`非秒数直方图必须使用量纲匹配的固定聚合`
