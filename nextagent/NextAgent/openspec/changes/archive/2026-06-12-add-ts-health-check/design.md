## 背景和现状（Context）

本 change 只收敛 health check 的最小业务契约，不包含 runtime metrics 的通用 registry / taxonomy / acquisition matrix。

health 的用户可见结果是 machine-readable HTTP response。metrics 的用户可见结果是 registry sample / snapshot。二者可以复用同一 observability 基础设施，但必须保持产品面和 owner 边界分离。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 明确 `GET /health` 和 `GET /health/deep` 的业务语义。
- 明确 primary health 是 bounded live check，deep health 才运行最小真实检查。
- 定义最小 `HealthProbe` 契约和 `HealthEvaluator` 聚合语义。
- 明确 health response schema、HTTP status mapping 和 safe diagnostics。
- 明确 health probe metrics 的语义和 labels 由本 change 拥有，写入机制复用 `add-ts-runtime-metrics`，不定义第二套 metrics registry。

### 非目标

- 不定义 runtime metrics 的 stable inventory、label taxonomy 或 acquisition matrix；这些属于 `add-ts-runtime-metrics`。
- 不定义 trace span model、trace exporter、structured logging、audit sink 或 release qualification。
- 不把 `HealthProbe`、`HealthEvaluator` 或 health response 类型提升到 `agent-contracts`。

## Owner 和唯一实施路径（Owner / Minimal Delta）

- 主 owner：`agent-observability` 拥有 health evaluator、safe diagnostics、timeout / AbortSignal handling 和 health probe metrics 写入行为。
- composition owner：`agent-app` 把各模块已有 safe public check 适配为 `HealthProbe` 并注册给 evaluator。
- transport owner：`agent-channel-web` 只负责 `GET /health` / `GET /health/deep` route projection、HTTP status-code mapping 和 response schema validation。
- 业务 owner：runtime、gateway、model provider、capability 等模块只暴露已有 public safe check、ping、readiness 或依赖状态读取能力；不得 import observability projector、metrics registry、tracing SDK、logger、audit writer、metric names 或 health response internals。

唯一实施路径：

1. 在 `agent-observability` 内定义 `HealthStatus`、`ComponentHealth`、`HealthCheckResponse`、`HealthProbe` 和 `HealthEvaluator`。
2. 实现 primary evaluator：只执行 bounded live check，不运行 registered module probes。
3. 实现 deep evaluator：运行 `agent-app` 注册的 `HealthProbe`，每个 probe 受 timeout 和 `AbortSignal` 约束。
4. 对 health diagnostics 执行 safe output 裁剪，只输出稳定 component、status、reasonCode、summary、latencyMs 和 timestamp。
5. `agent-channel-web` 暴露 `GET /health` / `GET /health/deep`，只投影 evaluator response；aggregate `UP` -> HTTP `200`，`DOWN` / `DEGRADED` -> HTTP `503`。
6. 在 `add-ts-runtime-metrics` 提供 `MetricsRegistry` / label validation primitives 后，health evaluator SHALL 使用该 registry 写出本 change 拥有语义和 labels 的 `health_probe_total` 与 `health_probe_duration_seconds`；若 metrics registry 不可用，health response 仍按 evaluator 事实返回，并记录 bounded health degradation。

本 change 依赖 `add-ts-redaction-policy` 提供 HEALTH_DIAGNOSTIC surface policy，并依赖 `add-ts-runtime-metrics` 提供 registry / label validation primitives。`health_probe_total` / `health_probe_duration_seconds` 的业务语义、触发边界和 allowed labels 由本 change 拥有；registry、counter / histogram 写入机制和通用 label validation primitives 由 `add-ts-runtime-metrics` 拥有。不得在本 change 中定义第二套 metrics registry、metric event bus、通用 label taxonomy、exporter、file flush path 或 replay worker。

## Health Probe Metrics Boundary

`health_probe_total` 和 `health_probe_duration_seconds` 的触发语义属于 health evaluator：在 primary / deep evaluator 完成、失败、降级或超时后产生。它们是 health-owned metric samples：name、purpose、triggering boundary 和 allowed labels 由本 change 定义；写入目标和通用 label validation primitives 复用 `add-ts-runtime-metrics` 的 `MetricsRegistry` / label policy。

Allowed labels：

- `endpoint=primary|deep`
- `status=UP|DOWN|DEGRADED`
- `component=runtime_authority|gateway|model_provider|capability`

Health response 不是 metric sample，不得作为后续 metric 回放来源。metric 写出失败不得改变 health evaluation truth 或 HTTP projection。

## 运行预算与安全限制

- primary health 必须轻量、有界、同步，不触发真实模型调用、真实写操作或深度业务探测。
- deep health probe 必须受 per-check timeout 和 `AbortSignal` 约束，不得执行真实写操作。
- health endpoint 不接受 request body，不允许客户端覆盖 component、timeout、status 或 raw diagnostics。
- health response 不得输出 raw error、stack trace、filesystem path、secret、credential、prompt、model output、raw provider error、tenant / subject 诊断细节或自由文本形式关键失败语义。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/system-health-check/spec.md`
