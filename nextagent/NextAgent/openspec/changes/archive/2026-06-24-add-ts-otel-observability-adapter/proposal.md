## 背景与问题（Why）

当前 `agent-observability` 已经冻结了统一 observation stream、`ObservabilityProjectorHost`、`MetricsProjector`、`StructuredLogProjector`、safe redaction 和 OTel mapping placeholder，但真正的 OpenTelemetry trace / metric adapter 还没有落地。仓库里保留了 `@opentelemetry/api` 依赖与 [packages/agent-observability/src/linking/otel-mapping.ts](../../../../packages/agent-observability/src/linking/otel-mapping.ts)，同时测试明确要求“冻结 future OpenTelemetry trace projector mapping，但不实现 exporter”。这意味着当前系统只有 OTel 前置抽象，没有真正把 TRACE / METRIC surface 接到官方 OTel API。

这个缺口带来三个实际问题：

1. `TRACE` surface 已经是 `ObservabilitySurface` 的稳定枚举值，但产品路径没有对应 projector，`ObservabilityProjectorHost` 也没有真实 TRACE consumer，导致 trace 只能停留在设计层占位。
2. `MetricsProjector` 当前虽然已经通过 `MetricsRegistry` 抽象写入，但默认实现只覆盖本地 in-memory 行为，缺少一套统一 registry 主逻辑下可切换的 OTel sink/output，对企业常见的 OTel meter/exporter 集成仍未真正落地；`@opentelemetry/api` 依赖因而长期处于“声明但未使用”状态。
3. 现有 stable spec 已经要求后续 trace projector 使用 OpenTelemetry 1.9.0 语义、W3C Trace Context 和 OTLP traces，但没有一份 active change 把最小接线路径、模块 owner、attribute allowlist、degraded policy 和验证路径收敛成唯一实现方案，实施阶段容易在 `agent-app`、`agent-observability`、业务 wrappers 或外部 exporter 之间分叉。

现在补这项 change 的必要性在于：在不改变核心 observation contract、不中断现有 LOG/AUDIT/METRIC 产品路径、也不把 OTel SDK 类型泄漏到 runtime/core/model/capability/channel/gateway public contract、也不调整 gateway implementation 的前提下，给 `TRACE` 和带 remote OTel sink 的 `METRIC` 提供一个最小、可验证、可替换的正式落地方案。

## 变更范围（What Changes）

- 在 `agent-observability` 新增最小 OTel integration adapter：
  - 新增 `TraceProjector`，作为 `ObservabilityProjectorHost` 的固定 `TRACE` surface projector，消费已 sanitize 的 `ObservabilityObservationEvent`；
  - 统一 `MetricsRegistry` 主逻辑，在保留现有 `MetricsProjector` 和 metric inventory 的前提下，把 local / remote 差异下沉到 sink/output：local 可直接镜像 `nextagent-observability.log`，remote 可把 counter / histogram 写到 OpenTelemetry Meter API。
- 在 `agent-app` composition 增加受控装配路径：
  - `createObservabilityProjectorHost(...)` 的 fixed projector set 可以包含 `TRACE` projector；
  - `agent-app` 可以显式选择 unified `MetricsRegistry` 连接本地日志 sink 或 remote OTel sink，但业务模块仍只看到现有 `MetricsRegistry` / `ObservabilityProjector` 抽象；
  - 其中 local 模式下 registry 允许直接把有界 metric diagnostics 写入 `nextagent-observability.log`，作为默认本地/测试可见输出。
- gateway 边界保持不变：
  - 不修改 `agent-platform-gateway-local`、`agent-platform-gateway-remote` 的 public port、实现逻辑、持久化路径或 transport 行为；
  - 本 change 如果需要覆盖 gateway 相关 trace 语义，只能通过 `agent-app` / `agent-observability` owning 的现有调用包装和 projector 消费实现，不调整 gateway implementation。
- 明确 TRACE / OTel metrics 的安全边界：
  - projector 和 registry adapter 只能消费 host 已 redaction 的 observation；
  - trace span attributes 与 metric labels 继续使用低基数、allowlist 和 bounded safe fields；
  - `traceId`、`spanId`、OTel context carrier、tracer / meter / provider / exporter 类型不得进入 `agent-contracts`、runtime timeline、gateway records、message metadata 或 public DTO。
- 明确最小 propagation / exporter 语义：
  - cross-process propagation 使用 W3C Trace Context；
  - trace exporter 语义对齐 OTLP traces；
  - OTel SDK 初始化、provider / meter / tracer 装配只归 `agent-observability` 与 `agent-app` composition owner。
- 明确 degraded / fail-closed 行为：
  - OTel tracer / meter 不可用、attribute serialization 失败、adapter project 失败时，TRACE / METRIC surface 必须返回现有 `SurfaceProjectionResult` 语义；
  - 不得影响 request lifecycle、terminal commit、stream projection、gateway call、health response 或其它 observability surfaces。

## Capability 影响（Capabilities）

### 新增 Capability
- `otel-observability-adapter`: 定义如何在不改变 observation contract 和业务模块边界的前提下，把 `ObservabilityProjectorHost` 接到真实 OpenTelemetry trace / metric adapter。

### 修改的 Capability
- `trace-log-linking`: 当前 stable spec 只冻结 future OpenTelemetry mapping、禁止 exporter 实现并强调 trace propagation 仍属后续 concern；本 change 需要把“future trace projector”收敛为正式 implementation-owned adapter 路径，并补充 TRACE surface 的 projector owner、safe attribute 映射、W3C propagation 和 degraded policy。
- `agent-runtime-metrics`: 当前 stable spec 把 `MetricsRegistry` 定义为 in-process output target；本 change 需要明确 unified `MetricsRegistry` 仍通过统一 `MetricsProjector` 和既有 label policy 工作，并说明 local sink 可直接写 `nextagent-observability.log`、remote sink 可对接 OTel，同时保持单一 registry 主逻辑。

## 影响范围（Impact）

- 代码模块：
  - `packages/agent-observability`
  - `packages/agent-app`
  - 相关 tests 与 architecture gates
- 依赖：
  - `@opentelemetry/api` 从“声明未使用”变为正式使用
  - 如实现需要，后续可能新增官方 OTel SDK/provider/exporter 组件，但必须限定在 `agent-observability` / `agent-app`
- 行为与配置：
  - `TRACE` surface 从占位枚举变为可装配 projector
  - metrics 可从默认直接写 `nextagent-observability.log` 的 local sink 扩展为 remote OTel sink，而不拆分第二套 registry 主逻辑
  - 需要明确 OTel adapter 的启动/注入配置，但不新增业务侧 API
- 测试与验证：
  - trace projector tests
  - unified metrics registry sink/output tests
  - composition integration tests
  - architecture tests，确保 OTel SDK 类型不泄漏到非 owning packages
- 运维面：
  - 可观测接线从“内部 observation + 日志/内存 metric”扩展为可对接标准 OTel tracing/metrics backend

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/otel-observability-adapter/spec.md`：新增
- `openspec/specs/trace-log-linking/spec.md`：修改，收敛 future OpenTelemetry mapping 为正式 projector / propagation / exporter adapter 语义
- `openspec/specs/agent-runtime-metrics/spec.md`：修改，补充 unified `MetricsRegistry` 与 local/remote sink 策略契约

长期背景：
- `openspec/overview.md`：无

设计视图：
- `openspec/designs/architecture/observability-boundaries.md`：修改，补充 OTel trace/metric adapter、attribute/label 安全边界、degraded policy 和 app composition owner
- `openspec/designs/modules/agent-observability.md`：修改，补充 TraceProjector、unified metrics registry sink/output owner 和 OTel SDK owner
- `openspec/designs/modules/agent-app.md`：修改，补充 OTel observability adapter 的 composition 注入职责
- `openspec/designs/adr/0001-ts-backend-stack.md`：修改，补充 OTel 选型从 wrapper 占位进入正式最小落地的长期事实
- `openspec/designs/spec-to-design-map.md`：修改，增加 `otel-observability-adapter` 到 architecture/modules/ADR 的导航

验证入口：
- trace projector tests
- unified metrics registry sink/output tests
- observability composition integration tests
- architecture leakage tests
- `npm run build`
- `npm test`
- `npm run lint:architecture`
- `openspec validate --all --strict`
