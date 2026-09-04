## MODIFIED Requirements

### Requirement: Metric domain objects 必须有稳定语义

`MetricDescriptor` SHALL 定义 metric name、type、unit、allowed labels、value source 和 acquisition source。`MetricSample` SHALL 包含 name、type、有限非负 value、allowed labels、occurredAt 和 dedup key。`MetricsRegistry` SHALL 是 `agent-observability` owning 的 implementation-local output target abstraction；它 MUST 保持单一 registry 主逻辑，并允许 `agent-app` composition 只通过切换 sink/output 策略来选择 local log 输出或 remote OTel 输出，但 MUST NOT 改变 `MetricsProjector` 的输入 observation、output outcome、metric inventory、label taxonomy、dedup 语义或 degraded / failed-closed contract。local sink MAY 作为默认本地/测试实现直接把 bounded metric diagnostics 写入 `nextagent-observability.log`；这种日志写入属于 registry implementation 细节，不得改变 metric contract。`MetricProjectionResult` SHALL 固定为 `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。

Metric descriptors、samples 和 registry types SHALL 保留在 `agent-observability` 内部，不得通过 `agent-contracts` 导出。OTel meter、counter、histogram、provider 或 exporter 类型同样不得进入 `agent-contracts`、runtime、core、model、capability、gateway 或 channel public contract。

#### Scenario: Metrics 不进入 core contracts
- **WHEN** metrics implementation 或 OTel adapter 被添加
- **THEN** `agent-contracts` 不得暴露 metric descriptors、samples、registry、label taxonomy、meter 或 exporter 类型

#### Scenario: remote OTel sink 保持 projector contract
- **WHEN** `MetricsProjector` 使用 unified `MetricsRegistry` 且其 remote OTel sink 被启用
- **THEN** projector MUST 继续只通过 `MetricsRegistry` 抽象写入 sample
- **AND** 同一个 observation 的 `SurfaceProjectionResult` 语义 MUST 与 local sink 保持一致

#### Scenario: sink/output 可替换但行为不可漂移
- **WHEN** `agent-app` 在 composition 时为 unified `MetricsRegistry` 从 local sink 切换到 remote OTel sink
- **THEN** metric name、allowed labels、dedup key、invalid label/value 处理和 high-cardinality 拒绝语义 MUST 保持不变
- **AND** business owner packages 不得因 sink/output 切换而修改调用方式或切换 registry 类型

#### Scenario: local sink 直接写 observability log 时仍保持 contract
- **WHEN** unified `MetricsRegistry` 的 local sink 把 metric diagnostics 直接写到 `nextagent-observability.log`
- **THEN** 该输出 MUST 只包含 bounded metric contract 可导出的名称、标签和值
- **AND** 这种实现细节不得让 `MetricsProjector`、wrappers 或业务 owner 直接依赖日志写入成功
