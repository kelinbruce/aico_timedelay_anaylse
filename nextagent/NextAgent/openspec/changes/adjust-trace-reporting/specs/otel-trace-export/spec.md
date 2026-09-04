# otel-trace-export Specification Delta

## ADDED Requirements

### Requirement: OTLP exporter 只需 endpoint 即可创建

`createOtlpTraceProjector` MUST 在 `options.endpoint` 存在时创建 `OTLPTraceExporter`，MUST NOT 要求 `authPk` 或 `authSk` 同时存在。exporter 创建时 MUST NOT 设置 `Authorization` header。`authPk` 和 `authSk` 字段 MAY 出现在 `OtlpTraceInfrastructureOptions` 中以保持向后兼容，但 MUST NOT 影响 exporter 创建决策。

system config 的 `observability.tracing` MUST 只要求 `endpoint` 存在即视为远程上报配置完整；`authPkRef` 和 `authSkRef` 如配置 MUST 被忽略且 MUST NOT 导致校验失败。`endpoint` 缺失时 MUST 保持现有不创建 exporter 的行为。

去掉 Basic Auth 后，endpoint MUST 通过 SecretReference（`env:` 或 `file:`）解析，MUST NOT 以明文出现在 config 文件中。部署方 MUST 确保 endpoint 自身受网络层访问控制保护，因为 trace 上报不再携带认证凭据。

**需求类别**：功能性需求

#### Scenario: 只配置 endpoint 时创建 exporter

- **WHEN** `observability.tracing.enabled=true` 且只配置 `endpoint`
- **THEN** 系统 MUST 创建 `OTLPTraceExporter` 并使用该 endpoint
- **AND** exporter MUST NOT 包含 `Authorization` header
- **AND** 系统 MUST 正常远程上报 trace

#### Scenario: 已有 authPkRef/authSkRef 配置被忽略

- **WHEN** `observability.tracing` 同时配置了 `endpoint`、`authPkRef` 和 `authSkRef`
- **THEN** 系统 MUST 创建 `OTLPTraceExporter` 并使用该 endpoint
- **AND** exporter MUST NOT 包含 `Authorization` header
- **AND** `authPkRef` 和 `authSkRef` MUST NOT 导致校验失败

#### Scenario: endpoint 缺失时不创建 exporter

- **WHEN** `observability.tracing.enabled=true` 且 `endpoint` 缺失
- **THEN** 系统 MUST NOT 创建 `OTLPTraceExporter`
- **AND** 进程内 trace MUST 继续可用

#### Scenario: endpoint 解析失败时降级

- **WHEN** `observability.tracing.enabled=true` 且 `endpoint` SecretReference 解析失败
- **THEN** 系统 MUST 输出 `ENDPOINT_RESOLUTION_FAILED` 安全原因
- **AND** 系统 MUST NOT 发送远程 trace 请求
- **AND** 已启用的进程内 trace MUST 继续可用

## MODIFIED Requirements

### Requirement: OTel tracing 配置必须走 system config + SecretReference

system config 的 `observability.tracing` MUST 接受 OPTIONAL `enabled`、`endpoint`、`authPkRef`、`authSkRef` 和 `serviceName`。`enabled` MUST 为 boolean。`serviceName` MUST 为非敏感字符串，缺失时 MUST 使用 `nextagent`。

`endpoint` MUST 使用 `env:VAR_NAME` SecretReference 并 MUST 由 `AppCredentialResolver` 解析。`authPkRef` 和 `authSkRef` MAY 配置但 MUST 被忽略，MUST NOT 影响 exporter 创建。`endpoint` 存在时系统 MUST 创建 `OTLPTraceExporter` 并使用解析后的 endpoint URL。`endpoint` 缺失时系统 MUST 跳过 exporter 创建。

`enabled=false` MUST 关闭进程内 trace 和 exporter，并 MUST 关闭 taskEventId 的运行绑定、timeline 属性与出站传播。`enabled=true` 且 `endpoint` 缺失时 MUST 只启用进程内 trace。`enabled` 缺失且 `endpoint` 存在时 MUST 保持自动启用。`enabled` 和 `endpoint` 均缺失时 MUST 关闭 trace。

**需求类别**：功能性需求

#### Scenario: 配置完整时正常解析

- **WHEN** `observability.tracing` 的 `endpoint` 已配置且 SecretReference 解析成功
- **THEN** app entrypoint MUST 将解析后的 endpoint URL 传递给 `agent-observability` owning 的 OTel trace infrastructure factory
- **AND** `AppCredentialResolver` MUST 对 `endpoint` SecretReference 执行校验和解析

#### Scenario: 配置项格式校验

- **WHEN** `endpoint` 不符合其允许的 SecretReference 格式
- **THEN** config validation MUST 报告校验失败
- **AND** 系统 MUST NOT 将原始值传入 OTel SDK

#### Scenario: 显式启用但未配置 exporter

- **WHEN** `observability.tracing.enabled=true` 且 `endpoint` 缺失
- **THEN** 系统 MUST 启用进程内 trace、timeline enrichment 和 W3C 传播
- **AND** 系统 MUST 不创建 OTLP exporter

### Requirement: trace export 边界 MUST 追加 gen_ai.* 属性

`instrumentTraceExporterDiagnostics` 包装的 export 函数 MUST 在调用原始 `exporter.export(spans, ...)` 前，对每个 Span 追加 OpenTelemetry GenAI Semantic Conventions 的 `gen_ai.*` 属性。由于 OTel SDK 的 `ReadableSpan.attributes` 为 `readonly`，映射层 MUST 对每个 Span 创建浅拷贝并合并 attributes，MUST NOT 修改原始 `ReadableSpan` 对象。映射 MUST 只读取已有 `nextagent.*` attributes，MUST NOT 修改或删除任何已有 key，MUST NOT 引入 prompt、model output、tool args/result、credential 或其他禁止字段。

映射层 MUST 通过 `nextagent.observation_type` 判断权威 Span 类型（`request`/`model`/`tool`/`workflow_node`）。辅助 Span（TraceProjector 创建的 `gateway`/`system` 类型）不设置 `nextagent.observation_type`，映射层 MUST NOT 为其追加 `gen_ai.operation.name` 或 `gen_ai.response.status`，但 MAY 为其追加通用属性。

通用映射规则（所有 Span 类型，来源 key 不存在时跳过对应目标 key）：

| 来源 key | 目标 key |
|---|---|
| `nextagent.owner.agent_id` | `gen_ai.agent.id` |
| `nextagent.owner.agent_version` | `gen_ai.agent.version` |
| `session.id` | `gen_ai.conversation.id` |
| `nextagent.usage.input_tokens` | `gen_ai.usage.input_tokens` |
| `nextagent.usage.output_tokens` | `gen_ai.usage.output_tokens` |

按 Span 类型（`nextagent.observation_type`）的映射规则：

| observation_type | gen_ai.operation.name | gen_ai.response.status 映射 |
|---|---|---|
| `request` | `invoke_agent` | success→completed, failure→failed, canceled→cancelled |
| `model` | `chat` | 同上 |
| `tool` | `execute_tool` | 同上 |
| `workflow_node` | `invoke_workflow` | 同上 |
| 缺失（辅助 Span） | 不设置 | 不设置 |

`gen_ai.response.status` MUST 只在 `nextagent.outcome` 存在时追加。映射异常 MUST NOT 阻止 export，MUST NOT 修改原始 span attributes 中的 `nextagent.*` key。映射层追加的 `gen_ai.*` 属性增加的 payload 大小 MUST NOT 超过每个 Span 8 个 string/int 字段。

**需求类别**：功能性需求

#### Scenario: Request Span 追加 gen_ai 属性

- **WHEN** 一个 `nextagent.observation_type=request` 的 Span 被 export
- **AND** 该 Span 包含 `nextagent.owner.agent_id`、`session.id` 和 `nextagent.outcome=success`
- **THEN** export 前 attributes MUST 追加 `gen_ai.operation.name=invoke_agent`、`gen_ai.agent.id`、`gen_ai.conversation.id` 和 `gen_ai.response.status=completed`
- **AND** 原有 `nextagent.*` key MUST 保持不变

#### Scenario: Model Span 追加 gen_ai usage 属性

- **WHEN** 一个 `nextagent.observation_type=model` 的 Span 被 export
- **AND** 该 Span 包含 `nextagent.usage.input_tokens=100` 和 `nextagent.usage.output_tokens=200`
- **THEN** export 前 attributes MUST 追加 `gen_ai.usage.input_tokens=100`、`gen_ai.usage.output_tokens=200` 和 `gen_ai.operation.name=chat`
- **AND** 原有 `nextagent.*` key MUST 保持不变

#### Scenario: 辅助 Span 只追加通用属性

- **WHEN** 一个不包含 `nextagent.observation_type` 的 Span 被 export
- **AND** 该 Span 包含 `nextagent.owner.agent_id` 和 `session.id`
- **THEN** export 前 attributes MUST 追加 `gen_ai.agent.id` 和 `gen_ai.conversation.id`
- **AND** MUST NOT 追加 `gen_ai.operation.name`
- **AND** MUST NOT 追加 `gen_ai.response.status`

#### Scenario: 缺少来源 key 时跳过对应 gen_ai key

- **WHEN** 一个 Span 的 attributes 不包含 `nextagent.owner.agent_id`
- **THEN** export 前 MUST NOT 追加 `gen_ai.agent.id`
- **AND** 其他存在的来源 key 对应的 `gen_ai.*` 属性仍 MAY 被追加

#### Scenario: 缺少 outcome 时不设置 gen_ai.response.status

- **WHEN** 一个 Span 的 attributes 不包含 `nextagent.outcome`
- **THEN** export 前 MUST NOT 追加 `gen_ai.response.status`
- **AND** 其他 gen_ai.* 通用属性仍 MAY 被追加

#### Scenario: 映射不修改原始 ReadableSpan 对象

- **WHEN** 映射层处理一个 Span
- **THEN** 原始 `ReadableSpan` 对象的 `attributes` MUST NOT 被修改
- **AND** 传给原始 `exporter.export` 的 Span MUST 是包含合并后 attributes 的浅拷贝

#### Scenario: 映射异常不阻止 export

- **WHEN** 映射函数抛出异常
- **THEN** export MUST 仍正常执行
- **AND** 传给原始 exporter 的 Span MUST 包含原有 `nextagent.*` attributes（可能缺少 `gen_ai.*`）
