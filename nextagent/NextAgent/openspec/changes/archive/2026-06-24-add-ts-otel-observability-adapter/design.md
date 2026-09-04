## 背景和现状（Context）

当前 NextAgent 的 observability 主路径已经稳定在以下结构上：

- 业务 owner 只产生 `ObservabilityObservationEvent`；
- `ObservabilityProjectorHost.acceptObservation(event)` 是唯一 handoff 入口；
- `StructuredLogProjector`、`AuditProjector`、`MetricsProjector` 作为 fixed projector set 异步消费；
- redaction 在 host 接收边界执行；
- `AuditProjector` 默认通过 `AuditEventWriter` 落本地审计存储，本 change 同时允许在 writer owner 内部于持久化前同步镜像一份安全审计日志到 `nextagent-audit.log`；
- `MetricsProjector` 通过 `MetricsRegistry` 抽象写 metric，目前默认实现以本地 in-memory snapshot 为主，尚未把 local/remote sink 策略收敛为统一主逻辑；
- `TRACE` 已经是 `ObservabilitySurface` 的稳定枚举值，但没有真实 projector；
- `packages/agent-observability/src/linking/otel-mapping.ts` 只冻结了 OpenTelemetry 映射语义，没有接 SDK。

当前实现与 stable spec 的 gap 很明确：

1. `trace-log-linking` stable spec 已经把 OpenTelemetry、W3C Trace Context 和 OTLP traces 定为 future trace projector 的正式语义，但代码仍只停留在 placeholder mapping。
2. `agent-runtime-metrics` stable spec 里 `MetricsRegistry` 仍按 in-process output target 表述，代码也只有偏本地的 in-memory 实现，尚未把 local 日志输出与 remote OTel 输出统一到一套 registry 主逻辑下。
3. `agent-observability` 模块设计已经声明 “OTel integration wrapper” 是职责之一，但现状没有真正可装配的 OTel trace / metric implementation。

相关方包括：

- `agent-observability`：拥有 observation -> surface projector -> sink 的实现边界；
- `agent-app`：唯一 composition root，拥有 OTel adapter 的显式装配权；
- runtime/core/model/capability/gateway/channel：只能继续产生 observation 或调用包装后的 port，不能直接依赖 OTel SDK；其中 gateway implementation 不在本 change 调整范围内。
- 运维/平台集成方：需要标准 OTel trace / metric 接口，而不是 NextAgent 私有 trace wire format。

约束：

- 不修改 `ObservabilityObservationEvent`、`DiagnosticContext`、runtime timeline、gateway record、message metadata 或 public DTO shape；
- 不修改 `agent-platform-gateway-local`、`agent-platform-gateway-remote` 的 public gateway port、实现逻辑、持久化 owner、驱动接线或 transport 行为；
- 不把 `traceId`、`spanId`、OTel SDK 类型带入 `agent-contracts` 或业务模块 public contract；
- 不新增第二条 observability handoff path；
- 不把 audit 文件镜像职责下推到 gateway implementation；
- 不让 TRACE / METRIC adapter failure 反向影响 request lifecycle、terminal commit、stream 或 audit/log truth。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在现有 `ObservabilityProjectorHost` 架构下落地最小 OTel trace / metric adapter。
- 保持统一 observation stream，不新增 direct trace sink path 或 direct meter path。
- 明确唯一 owner：`agent-observability` 实现 adapter，`agent-app` 装配 provider / projector / registry。
- 让 `@opentelemetry/api` 从“声明未落地”变成正式依赖，并为后续 provider/exporter 扩展留下稳定边界。
- 保持既有 redaction、low-cardinality、degraded / fail-closed、projection outcome 语义。

**非目标：**

- 不在本 change 中新增业务侧 trace/span 字段。
- 不实现独立 trace store、trace replay、trace JSONL、remote trace sink contract 或跨进程 durable observability queue。
- 不改变 `MetricName`、metric inventory、allowed labels、request/run 事实模型或现有 LOG/AUDIT 主路径。
- 不在 runtime/core/model/capability/gateway/channel 中直接引入 OTel SDK。

## 设计决策（Decisions）

### 决策 1：TRACE 采用 `ObservabilityProjector` 形态接入，不新增新总线

唯一实现路径是：在 `agent-observability` 新增 `TraceProjector`，实现现有 `ObservabilityProjector` 接口，作为 `TRACE` surface 的 fixed projector 加入 `createObservabilityProjectorHost([...])` 的 projector set。

理由：

- 完整复用既有 redaction、queue、per-surface outcome 和 non-blocking 语义；
- 不破坏 `acceptObservation(event)` 这一唯一 handoff 入口；
- 与 LOG/AUDIT/METRIC 的 owner 模式保持同形同策。

放弃的方案：

- 在 wrappers 或 runtime listener 里直接调用 tracer：会把 OTel 实现细节扩散到业务 owner。
- 为 trace 单独引入 event bus / exporter worker：会形成第二条 observability path，破坏当前统一 handoff 模式。

### 决策 2：Metrics 保留单一 `MetricsRegistry` 主逻辑，local/remote 差异只存在于 sink/output

唯一实现路径是：保留 `MetricsProjector` 和既有 metric inventory，不改 acquisition / dedup / label policy；`MetricsRegistry` 继续作为唯一 registry contract 和主逻辑 owner，统一负责 sample 归一化、label/value 校验、dedup、projection outcome 与可选 snapshot；local/remote 差异只下沉到 registry 内部的 sink/output：

- local sink 允许直接把 bounded metric diagnostics 写入 `nextagent-observability.log`
- remote sink 允许把 counter / histogram 写到 OpenTelemetry Meter API
- 若后续需要双写，只能通过组合 sink 完成，而不是新增第二套 registry 主逻辑

理由：

- 当前 metric 名称、labels、投影逻辑已经稳定，不需要为 OTel 改写业务语义；
- 统一 registry 主逻辑可以避免 in-memory 与 OTel-backed 两套实现逐渐漂移；
- local sink 可直接提供本地/测试环境下的可见 metric 输出，不需要额外 snapshot emitter；
- remote 装配时只切 sink/output，不切换 registry 语义。

放弃的方案：

- 让 `MetricsProjector` 直接依赖 OTel meter：会把 OTel API 写死在 projector 里，削弱测试替换和 adapter owner 边界。
- 让业务 wrappers 直接写 OTel counter/histogram：会绕过 `MetricsProjector` 的 label policy 和 projection outcome contract。
- 为 OTel 单独新增第二套 `OTelBackedMetricsRegistry` 主实现：会制造与本地实现的语义漂移风险。

### 决策 3：OTel SDK/provider/exporter 初始化只允许出现在 `agent-observability` 与 `agent-app`

唯一实现路径是：

- `agent-observability` 提供 `createTraceProjector(...)`、统一 `MetricsRegistry` 的 sink/output helper；
- `agent-app` 在 composition 时显式选择：
  - 是否装配 `TraceProjector`
  - 使用 local log sink、remote OTel sink 或组合 sink
  - provider / propagator / exporter 的初始化参数

理由：

- `agent-app` 是唯一 composition root，符合既有架构；
- `agent-observability` 拥有 adapter-local observability libraries；
- 可以把 OTel 初始化、默认值、no-op / unavailable 行为压在 app composition 与 observability owner 内部。

放弃的方案：

- 在 `agent-contracts` 或 shared config contract 里新增 OTel SDK 类型：违反 contract clean boundary。
- 在业务模块中“就近初始化” tracer/meter：会制造 owner 漂移和配置散落。

### 决策 4：trace propagation 只通过 observability / app owning wrapper 与 W3C Trace Context 传播，不调整 gateway implementation

唯一实现路径是：cross-process trace propagation 只通过 observability-owned wrapper / middleware 使用 W3C Trace Context `traceparent` / `tracestate`。这些 wrapper 只能位于 `agent-observability` 或 `agent-app` composition owner，不得修改 gateway implementation 本身。需要 span link 或 async relation 时，使用 implementation-owned carrier 在 `agent-observability` 内部处理；`ObservabilityObservationEvent`、timeline、message metadata 和 gateway public contract 不新增 trace/span 字段。

理由：

- 与 stable `trace-log-linking` 的边界一致；
- 避免 trace context 变成业务 truth 或 durable contract；
- 防止业务 owner 误把 trace id 当成 request/run 主键。

放弃的方案：

- 把 `traceId/spanId` 持久化到 timeline/message/gateway record：会污染 durable fact。
- 依赖 consumer-local ALS 伪造 parent span：异步边界下不可靠，也不符合当前 spec。

### 决策 5：TRACE / OTel metrics adapter 严格复用现有安全 allowlist

唯一实现路径是：

- TraceProjector 只从 sanitized observation 中选取 allowlist attributes：
  - `boundary`
  - `operation`
  - `outcome`
  - `safeReasonCode`
  - owner scope
  - bounded `stableRefs`
  - bounded `durationMs`
  - bounded `usage`
  - policy-approved low-cardinality diagnostic candidates
- Metrics 继续使用现有 `validateMetricLabels()`、metric inventory 和 high-cardinality 禁止规则。

理由：

- 当前 redaction 与 low-cardinality policy 已经成熟；
- 不需要为 OTel 另发明第二套字段安全规则；
- 能直接复用现有 tests 与 architecture expectations。

放弃的方案：

- 为 OTel trace 单独开放更多 raw attributes：会绕开 shared redaction/allowlist policy。
- 允许 traceId/spanId、path、tenantId、subjectId、dynamic payload 进入 metric labels：违反既有 metrics spec。

### 决策 6：统一 `MetricsRegistry` 在 local 模式下允许直接写 `nextagent-observability.log`

当前 change 选择把 `MetricsRegistry` 视为唯一主逻辑 owner，而不是按 in-memory / OTel-backed 拆成两套 registry。它仍然通过 `increment/observe/snapshot` 暴露同一个 registry contract，但在 local 模式下允许于写入 sample 的同时，把 bounded metric diagnostics 直接写入 `nextagent-observability.log`。

这里的“直接写”是 registry implementation 自己拥有的日志落盘行为，不再引入额外的 snapshot emitter。稳定结论是：

- metrics 主路径仍是 `ObservabilityObservationEvent -> MetricsProjector -> MetricsRegistry`
- 当 `agent-app` 为 registry 装配 local sink 时，它可以在内部直接把 bounded metric diagnostics 写入 `nextagent-observability.log`
- 当 `agent-app` 为 registry 装配 remote OTel sink 时，本地直接日志行为可以不存在
- 这两种模式共享同一套 registry 主逻辑，而不是切换不同 registry 类型

这样做的理由：

- 比 snapshot emitter 更简单，避免新增额外 flush 组件与触发点；
- 对本地调试和测试更直接，metric 一旦产生就能在 observability log 中看到；
- 仍然不要求业务 owner、wrappers 或 `MetricsProjector` 感知日志文件存在。

约束：

- registry 直接日志输出只能写 bounded metric diagnostics：`metricName`、`kind`、allowed labels、value、dedup-related safe refs 等安全字段；
- 不得写 raw payload、trace id、span id、path、credential、token、自由文本或高基数字段；
- `MetricsProjector` 与业务路径不得依赖日志写入成功；
- registry 直接写日志失败时，只能按既有 degraded / failed-closed 语义处理，不得影响 request lifecycle、terminal truth 或其它 surface。

### 决策 7：`AuditEventWriter` 可在持久化前同步镜像安全审计日志到 `nextagent-audit.log`

当前 change 允许 `agent-observability` / `agent-app` owner 在不调整 gateway implementation 的前提下，把 `AuditProjector -> AuditEventWriter` 链路装饰成“双写”：

- 先把已通过 `AuditProjector` allowlist 的 `AuditEvent` 以安全字段镜像到 `nextagent-audit.log`
- 再调用既有 durable sink 完成 `gateway.audit.saveAuditEvent(...)` 持久化

这里的文件镜像是 writer owner 的 implementation detail，不改变 `AuditProjector`、gateway port 或 `audit_events` 持久化事实。稳定结论是：

- audit 主路径仍是 `ObservabilityObservationEvent -> AuditProjector -> AuditEventWriter`
- 默认 durable truth 仍是 `audit_events` 持久化表
- `nextagent-audit.log` 只是同步镜像输出，便于本地诊断和运维采集

约束：

- 镜像日志只允许写安全审计字段：`auditId`、`eventName`、owner scope、bounded stable refs、`safeSummary`、allowed `attributes`、`occurredAt`
- 不得写 prompt、模型输出、附件内容、path、credential、token、自由文本或高基数字段
- 文件镜像失败不得阻断 durable 审计持久化
- gateway implementation、gateway contract 和 `audit_events` schema 保持不变

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | OTel adapter 只能消费 host 已 sanitize 的 observation；`traceId/spanId`、raw payload、path、credential、token 不进入 contracts、timeline、message metadata、metric labels；span attributes 只走 allowlist。 | trace projector tests、redaction tests、architecture leakage tests |
| 性能/容量 | 不新增第二条 handoff path；TRACE 仍走 projector host 异步队列；metrics 仍在 projector 内同步生成 sample，再由统一 registry 主逻辑分派到 local/remote sink；不引入 durable trace queue。 | projector host integration tests、runtime metrics tests |
| 可靠性/恢复 | TraceProjector / remote OTel sink 失败只返回 degraded / failed_closed，不改写 request lifecycle、terminal truth 或其它 surface；provider/exporter 不可用时 fail closed。 | degradation tests、integration tests、negative tests |
| 可维护性 | 只在 `agent-observability` 与 `agent-app` 增加 OTel code；业务 owner 不感知 OTel；gateway implementation 保持不变；统一 registry 主逻辑避免 local/remote 语义分叉。 | architecture lint、module tests、code review |
| 可测试性 | `TraceProjector` 与统一 registry sink/output 都通过现有抽象注入；测试可继续使用 local log sink 或 fake tracer/meter facade；不要求真实 exporter。 | unit tests、integration tests |
| 审计/可追溯性 | TRACE 作为新 observability surface 与 LOG/AUDIT/METRIC 共用 observation truth；trace failure 只产生 bounded degradation evidence，不改写 audit/log truth。 | trace/log linking tests、observability degradation tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| TRACE 必须通过 `ObservabilityProjectorHost` fixed projector set 接入 | 1.1, 1.2 | trace projector unit/integration tests |
| OTel metrics 必须继续通过 `MetricsRegistry` 抽象接入 | 1.3 | metrics sink/output tests |
| OTel SDK 类型不得泄漏到非 owning package public contract，且 gateway implementation 不调整 | 2.1 | architecture leakage tests、`npm run lint:architecture` |
| Trace / metric adapter 只能消费 sanitized observation 和 allowlist fields | 1.2, 1.3 | redaction tests、trace projector tests、runtime metrics tests |
| `agent-app` 是唯一 composition root，负责 OTel adapter 装配 | 1.4 | composition tests、code review |
| TRACE / METRIC adapter failure 不得影响主流程或其它 surfaces | 2.2 | degradation tests、projector host integration tests |
| W3C Trace Context 与 OTLP traces 语义由 observability adapter owner 承担 | 1.2, 1.4 | trace adapter tests、code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：
  - `openspec/specs/otel-observability-adapter/spec.md`
  - `openspec/specs/trace-log-linking/spec.md`
  - `openspec/specs/agent-runtime-metrics/spec.md`
- 架构和跨模块设计：
  - `openspec/designs/architecture/observability-boundaries.md`
- 模块设计：
  - `openspec/designs/modules/agent-observability.md`
  - `openspec/designs/modules/agent-app.md`
- ADR：
  - `openspec/designs/adr/0001-ts-backend-stack.md`
- 导航：
  - `openspec/designs/spec-to-design-map.md`

主承载原则：

- Trace propagation / exporter / adapter owner 归 observability architecture 文档；
- projector / registry sink/output / app composition owner 归模块设计文档；
- 具体行为契约只放在 capability specs；
- 不在长期模块文档重复定义 metric inventory 或 observation contract 全量细节。

## 风险与取舍（Risks / Trade-offs）

- [OTel API 接上后容易继续把 SDK 类型扩散到业务模块] -> 通过 architecture tests 和 package boundary 检查，把 OTel import 限定在 `agent-observability` / `agent-app`。
- [TraceProjector 增加新的 surface，可能带来额外投影开销] -> 继续复用 projector host 的 bounded queue 和 per-surface degrade 语义，不增加 durable queue。
- [local sink 与 remote OTel sink 行为不一致] -> 保持统一 `MetricsRegistry` 主逻辑不变，并用同一组 projection outcome / label policy tests 约束不同 sink/output。
- [实现时把 trace context 当成业务事实回填] -> 明确禁止 `traceId/spanId` 进入 timeline、message metadata、gateway record 和 public DTO，并补负向测试。

## 迁移计划（Migration Plan）

1. 先在 `agent-observability` 增加 `TraceProjector` 与统一 `MetricsRegistry` sink/output owner，同时保留默认直接写 `nextagent-observability.log` 的 local sink。
2. 在 `agent-app` composition 中增加受控装配点，把 TRACE projector 和 unified metrics registry 的 local/remote sink 作为可选装配接入。
3. 在测试中先验证 no-op / unavailable / degraded 路径，确认不会影响主流程。
4. 若上线后发现 OTel provider / exporter 初始化有问题，回滚策略是：
   - 在 `agent-app` 关闭 TraceProjector 装配；
   - 切回直接写 `nextagent-observability.log` 的 local metrics sink；
   - 保留现有 LOG/AUDIT/METRIC(in-memory) 产品路径。

本 change 不要求数据迁移，也不要求修改持久化事实。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/otel-observability-adapter/spec.md`：沉淀 OTel adapter 的行为契约
- `openspec/specs/trace-log-linking/spec.md`：把 future OpenTelemetry mapping 更新为正式 projector / propagation contract
- `openspec/specs/agent-runtime-metrics/spec.md`：补充 unified registry 与 local/remote sink 的稳定语义
- `openspec/designs/architecture/observability-boundaries.md`：保留 OTel adapter owner、TRACE surface handoff、W3C / OTLP 语义和安全边界
- `openspec/designs/modules/agent-observability.md`：保留 TraceProjector、unified metrics registry sink/output、redaction/allowlist 复用结论
- `openspec/designs/modules/agent-app.md`：保留 composition 装配职责
- `openspec/designs/adr/0001-ts-backend-stack.md`：把 OTel 选型从占位说明更新为已落地最小 adapter 路径
- `openspec/designs/spec-to-design-map.md`：补齐 capability 到长期设计与验证入口导航

## 待确认问题（Open Questions）

- 当前 change 是否需要同时引入官方 OTel SDK/provider/exporter 具体 npm 包，还是先只把 `@opentelemetry/api` 的 projector / metrics sink 接口落地，再由后续实现 change 补 provider/exporter 组件。
- `TRACE` surface 首版的 span coverage 是否只覆盖 request/model/capability 四类 boundary，还是同时把 health/system diagnostics 一并纳入首版 projector coverage；本问题不允许通过调整 gateway implementation 来解决。
