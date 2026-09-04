## 背景与问题（Why）

NextAgent 轨迹上报当前存在三个限制：

1. **认证耦合**：OTLP trace exporter 要求 `endpoint + authPk + authSk` 三者齐全才创建 exporter，少一个就不远程发送。当前轨迹中心接受直接 HTTP 调用，不需要 Basic Auth，但配置和 exporter 初始化仍强制要求凭据。
2. **外部调用方无法传入 trace 上下文**：外部系统通过 `runtime.submit` 和 `runtime.answerPendingInput` 直接调用 runtime 层，不走 HTTP channel，因此不经过 Task Channel 的 `withIncomingCarrier` → `withIncomingCarrier` 路径。外部调用方的 traceId/spanId 无法进入 NextAgent 的 OTel Span 层级。
3. **Span 属性不符合 GenAI 语义规范**：上报到轨迹中心的 Span 属性使用 `nextagent.*` 前缀的私有 key，轨迹中心期望使用 OpenTelemetry GenAI Semantic Conventions 的 `gen_ai.*` 标准属性以便统一解析和展示。

## 变更范围（What Changes）

- **修改** OTLP trace exporter 初始化：只要有 `endpoint` 就创建 exporter，不再要求 `authPkRef`/`authSkRef`；config 校验放宽，不再强制三者齐全。
- **新增** `RequestLifecycleCoordinator` 的 `getExecutionCorrelation()` 方法，返回内部 `ExecutionCorrelationPort`。外部调用方通过该方法获取 port，使用 `withIncomingCarrier(carrier, operation)` 包裹 runtime 调用，将 W3C trace 上下文注入 `incomingCarrier` ALS。不修改 `RuntimeCommandPort` 接口签名，不在 command 上加字段，与 lvxiaoyang 的 Task Channel `withIncomingCarrier` 模式一致。
- **新增** trace export 边界的 `gen_ai.*` 属性映射层：在 `instrumentTraceExporterDiagnostics` 包装层中，于 Span export 前读取已有 `nextagent.*` attributes，按映射规则追加对应的 `gen_ai.*` attributes。现有 `nextagent.*` 全部保留，不改动任何 span 创建逻辑。

## 依赖与实施顺序

- 需求 1（去认证）和需求 3（gen_ai 映射）都修改 `agent-observability` trace 链路，可在同一实施批次完成。
- 需求 2（getExecutionCorrelation）修改 `agent-runtime`，独立于需求 1 和 3 的 exporter 改动，但需要在同一 change 中验证。
- 三个需求互不阻塞，但均修改 trace 上报链路，放在同一 change 中保持一致性。

## 不在范围内（Explicit Non-Goals）

- 不修改现有 Span 创建逻辑（`startAttributes`、`applyTerminalSpanState`、`traceAttributesFor` 原有 key 全部保留）。
- 不修改 timeline event payload 结构或 `inlinePayload` schema。
- 不修改 `incomingCarrier` 或 `executionScope` ALS 机制的存储和生命周期行为。
- 不修改 Request 终态后 120 秒 tombstone 清除策略。
- 不修改 W3C `traceparent`/`tracestate` 的解析和校验规则。
- 不修改 `gen_ai.*` 属性以外的 OTel 原生 Span 字段（traceId/spanId/parentSpanId）。
- 不新增 RAG 检索、Memory、Embeddings、Evaluation 等当前 NextAgent 不产生的 `gen_ai.*` 属性。
- 不修改 `trace-log-linking` spec 中 "DiagnosticContext MUST NOT 携带 traceId/spanId/traceContext" 的约束——trace carrier 只通过 `withIncomingCarrier` 注入 `incomingCarrier` ALS，不进入 DiagnosticContext、public DTO、gateway Record、runtime command 字段或 timeline payload。

## Capability 影响（Capabilities）

### 修改 Capability

- `otel-trace-export`：放宽 exporter 认证要求；新增 gen_ai 属性映射层。
- `ts-core-contracts`：`RequestLifecycleCoordinator` 新增 `getExecutionCorrelation()` 方法，暴露 `ExecutionCorrelationPort` 供外部调用方注入 trace 上下文。
- `trace-log-linking`：明确通过 `getExecutionCorrelation` + `withIncomingCarrier` 注入的 trace carrier 不违反 DiagnosticContext 约束。

## 影响范围（Impact）

- 代码：`packages/agent-observability`（exporter 初始化、gen_ai 映射）、`packages/agent-runtime/src/lifecycle/submit`（getExecutionCorrelation 方法）、`packages/agent-app/src/config/validation`（config 校验放宽）。
- 配置：`observability.tracing` 不再要求 `authPkRef`/`authSkRef`，已有配置仍兼容。
- 测试：trace exporter 初始化测试、gen_ai 映射测试、getExecutionCorrelation 注入测试、config 校验测试。
- 安全：去掉 Basic Auth 后，trace 上报不携带凭据；trace carrier 只来自外部调用方通过 `withIncomingCarrier` 注入，不来自请求体或模型输出；`gen_ai.*` 映射只读取已有安全 attributes，不引入新的敏感字段。
