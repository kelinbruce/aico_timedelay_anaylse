# system-health-check Specification

## Purpose
TBD - created by archiving change add-ts-health-check. Update Purpose after archive.
## Requirements
### Requirement: Health endpoints have distinct business meanings

系统 SHALL 将 health 入口分配为稳定且互不混淆的业务语义：

- 主 health 入口回答“最基础运行面是否仍可响应”；
- 深度 health 入口回答“关键真实业务路径现在是否真的可服务”。

当前 Web health contract SHALL 暴露以下最小 endpoint：

- `GET /health`：primary health endpoint，只执行 bounded live check。
- `GET /health/deep`：deep health endpoint，执行受 timeout / budget / critical 约束的最小真实检查。

`agent-channel-web` SHALL own HTTP route projection and status-code mapping, while `agent-observability` SHALL own health evaluation semantics and safe diagnostics. Health endpoints SHALL return the same machine-readable health response schema for healthy and not-healthy results. A healthy aggregate `UP` response SHALL use HTTP `200`; aggregate `DOWN` or `DEGRADED` response SHALL use HTTP `503`. Transport-level malformed requests MAY use Web-channel error handling, but health evaluation failures MUST be represented by the health response schema.

Health endpoints SHALL NOT require request body input and SHALL NOT accept client-supplied component names, tenant / subject diagnostics, timeout override, raw dependency detail, or health status override. Authentication policy is not defined by this change; when an auth boundary is present, it MAY protect the route, but auth identity MUST NOT affect health evaluation semantics or diagnostics.

#### Scenario: Health endpoints expose distinct operator meanings
- **WHEN** operator 或 orchestrator 读取不同 health 入口
- **THEN** 各入口分别返回稳定且不同的业务语义

### Requirement: The primary health endpoint is a bounded live check

主 health 入口 MUST 保持轻量、有界、同步。它只验证入口自身可响应、基础 runtime authority 可响应，并返回聚合状态与安全摘要。它 MUST NOT 触发真实模型调用、真实写操作或深度业务探测。

#### Scenario: Primary health endpoint does not run real business checks
- **WHEN** 调用方请求主 health 入口
- **THEN** 系统只执行轻量 live 检查
- **AND** 不触发真实业务调用测试

#### Scenario: Primary health endpoint returns unhealthy when base authority cannot respond
- **WHEN** 主 health 入口被读取且基础 authority 超时、异常或不可响应
- **THEN** 系统显式返回 unhealthy
- **AND** 输出安全失败摘要

### Requirement: The deep health endpoint runs real checks in-band

深度 health 入口 SHALL 在读取路径上现场执行最小真实检查，而不是只读取配置前置或只读 hook 结果。真实检查必须使用隔离上下文、受 timeout / 预算 / 频率约束，并输出逐组件稳定结果。

Deep health checks SHALL be supplied through a minimal `HealthProbe` contract assembled by `agent-app` and evaluated by `agent-observability`. `HealthProbe` SHALL represent a bounded safe check with stable `name`, `critical`, `timeoutMs`, an abortable `run(signal)` operation, and a safe result containing only `status`, optional `reasonCode`, optional `summary`, and optional `latencyMs`. `HealthProbe` is a health-domain integration contract, not a logger / tracer / metrics SDK. Business packages MAY expose existing safe public checks or dependency status ports, but MUST NOT import observability projectors, metrics registry, tracing SDK, logger, audit writer, metric names, or health output internals just to participate in health evaluation. `agent-app` MUST adapt those public checks into `HealthProbe` registrations.

`HealthProbe` MUST NOT accept tenant / subject / request body / prompt / model output / raw provider detail / path / secret as input, MUST NOT return raw error / stack trace / path / credential / owner-private diagnostic detail, and MUST NOT perform real writes. Primary health MUST NOT run module probes; only deep health may run registered probes under timeout and AbortSignal.

#### Scenario: Deep health endpoint performs a real dependency check
- **WHEN** 深度 health 入口需要验证关键依赖
- **THEN** 系统执行最小真实调用测试
- **AND** 不只依赖配置存在性或只读 hook

#### Scenario: Health probes are adapted at composition
- **WHEN** runtime、gateway、model provider 或 capability owner exposes a safe public check
- **THEN** `agent-app` adapts it into a `HealthProbe` for `agent-observability`
- **AND** the owner package does not import observability SDKs, metrics registry, tracer, logger, audit writer, metric names or health response internals

#### Scenario: Deep health endpoint fails when a critical real check times out
- **WHEN** 某个 critical component 的最小真实操作超时
- **THEN** 系统显式返回 not-healthy
- **AND** 输出该 component 的安全失败证据

### Requirement: Health output is machine-readable and diagnostic-safe

每次 health 响应 MUST 产生机器可读结果，至少包含聚合状态、稳定 component 名称与状态、检查时间，以及安全 `summary` / `reasonCode` / `latencyMs` 等受控诊断字段。

Health response 的目标字段 SHALL 使用以下语义：

- `status`：聚合状态，值域为 `UP`、`DOWN` 或 `DEGRADED`。
- `components`：逐组件结果集合。
- `components[].name`：稳定 component 名称，不包含 path、tenant、subject、session、request 或 provider raw detail。
- `components[].status`：组件状态，值域为 `UP`、`DOWN` 或 `DEGRADED`。
- `components[].summary`：可选安全摘要，只能承载通用可诊断描述。
- `components[].reasonCode`：可选稳定原因码，用于机器判断失败或降级类型。
- `components[].latencyMs`：可选有界耗时。
- `timestamp`：health evaluation 完成时间。

Health response MUST NOT 输出 raw error、stack trace、filesystem path、secret、credential、prompt、model output、raw provider error、tenant / subject 诊断细节或自由文本形式的关键失败语义。

#### Scenario: Health response exposes stable machine-readable diagnostics
- **WHEN** 任一 health 入口返回检查结果
- **THEN** 响应包含聚合状态、稳定 component 状态和受控诊断字段
- **AND** 不依赖自由文本承载关键诊断语义

### Requirement: Health remains bounded, explicit, and fail-safe

当 health evaluation 遇到 probe timeout、配置缺失、dependency exception、real-check timeout、预算耗尽或安全摘要生成失败时，系统 MUST 显式降级，而不是静默返回 healthy。

#### Scenario: Diagnostic sanitization failure falls back to safer diagnostics
- **WHEN** health path 原本要输出的 dependency reason 无法安全裁剪
- **THEN** 系统退化为 reason code、generic safe summary 或 omitted marker
- **AND** 不暴露原始敏感原因

### Requirement: Health probe metrics are health-owned samples written through the runtime metrics registry

Health evaluator SHALL emit `health_probe_total` and `health_probe_duration_seconds` after primary / deep evaluation completes, fails, degrades or times out. The health probe metric names, purposes, triggering boundaries and allowed labels are owned by this change. The samples SHALL be written through the `MetricsRegistry` and label validation primitives defined by `add-ts-runtime-metrics`; this change SHALL NOT define a second metrics registry, metric event bus, generic label taxonomy, exporter, file flush path or replay worker.

Allowed health probe metric labels SHALL be limited to `endpoint=primary|deep`, `status=UP|DOWN|DEGRADED`, and `component=runtime_authority|gateway|model_provider|capability`. Health response output MUST NOT be replayed as metric input. Metrics write failure MUST NOT change health evaluation truth or HTTP status projection.

#### Scenario: Health evaluator writes bounded probe metrics
- **WHEN** primary or deep health evaluation completes, fails, degrades or times out
- **THEN** the evaluator SHALL write `health_probe_total` and `health_probe_duration_seconds` through the runtime metrics registry
- **AND** label validation follows the runtime metrics policy

#### Scenario: Health probe metric failure does not rewrite health truth
- **WHEN** the metrics registry is unavailable or rejects a health probe label
- **THEN** the health response remains based on evaluator facts
- **AND** the system records bounded health diagnostics or degradation without replaying the response as metrics

