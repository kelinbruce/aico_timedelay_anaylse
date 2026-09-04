## 1. OTel adapter 主路径实现

- [x] 1.1 在 `agent-observability` 新增 `TraceProjector` 及其受控 attribute 映射 helper，让 `TRACE` surface 以 `ObservabilityProjector` 形态消费 sanitized `ObservabilityObservationEvent`，并使用 OpenTelemetry API 语义创建 span / span event / span link。
  验证：新增 `packages/agent-observability/tests/trace-projector.test.ts`，覆盖 covered / not-covered / emitted / degraded / failed_closed；`npm test -- trace-projector`
  来源：`otel-observability-adapter` Requirement “TraceProjector 必须只消费安全 observation 并映射到 OTel trace 语义”；design 决策 1、4、5
- [x] 1.2 调整 unified `MetricsRegistry` 的 local sink 行为，让其在保持既有 `MetricsProjector`、metric inventory、label allowlist、dedup 和 projection outcome 不变的前提下，直接把 bounded metric diagnostics 写入 `nextagent-observability.log`。
  验证：新增或补充 `packages/agent-observability/tests/metrics-registry.test.ts`，断言 metric sample 生成时 observability log writer 被调用且输出不含高基数字段；`npm test -- metrics-registry runtime-metrics`
  来源：`agent-runtime-metrics` Requirement “Metric domain objects 必须有稳定语义”；design 决策 2、6
- [x] 1.3 在 `agent-observability` 统一 `MetricsRegistry` 主逻辑，并为其增加 local log sink / remote OTel sink output helper，保持同一套 metric contract、label policy、dedup 和 projection outcome。
  验证：新增 `packages/agent-observability/tests/otel-metrics-sink.test.ts`；复用或补充 `tests/agent-kernel/runtime-metrics.test.ts`；`npm test -- runtime-metrics otel-metrics-sink`
  来源：`otel-observability-adapter` Requirement “Metrics sink/output 必须保持既有 metric inventory 与标签策略”；`agent-runtime-metrics` Requirement “Metric domain objects 必须有稳定语义”；design 决策 2、5
- [x] 1.4 在 `agent-observability` 暴露 `createTraceProjector(...)`、metrics sink/output helper 等最小 helper，但不把 OTel SDK/provider/exporter 类型暴露到 `agent-contracts` 或业务 package public contract。
  验证：`npm run build`；code review 检查 `packages/agent-observability/src/index.ts` 与 package exports 不泄漏 OTel SDK 类型
  来源：`trace-log-linking` Requirement “trace propagation 必须保持为 observability implementation concern”；design 决策 3
- [x] 1.5 在 `agent-app` composition 中新增受控装配路径，让 projector host 可以包含 `TRACE` projector，并允许统一 `MetricsRegistry` 在 local log sink 与 remote OTel sink 之间切换，同时保持现有 `acceptObservation(event)` handoff 不变。
  验证：新增或补充 `tests/agent-kernel/trace-log-linking.test.ts` / `tests/agent-kernel/otel-observability-adapter.test.ts`；`npm test -- trace-log-linking otel-observability-adapter`
  来源：`otel-observability-adapter` Requirement “OTel adapters 必须通过既有 observation handoff 路径接入”；design 决策 1、2、3

## 2. 边界约束与负向验证

- [x] 2.0 在不调整 gateway implementation 的前提下，为 `AuditEventWriter` 增加持久化前同步镜像到 `nextagent-audit.log` 的 owner-side 实现，并验证镜像失败不会阻断 `audit_events` durable persistence。
  验证：新增 `packages/agent-observability/tests/logging-audit-writer.test.ts`；`npx vitest run packages/agent-observability/tests/logging-audit-writer.test.ts`
  来源：design 决策 7
- [x] 2.1 增加 architecture / source-level negative tests，确保 OTel import 只允许出现在 `agent-observability` 与 `agent-app` composition owner，`agent-contracts`、runtime、core、model、capability、gateway、channel 不得出现 tracer、meter、provider、exporter、propagator 或 `traceId/spanId` contract 泄漏；同时断言本 change 不修改 gateway implementation 文件。
  验证：新增或补充 architecture tests；`npm run lint:architecture`
  来源：`trace-log-linking` Requirement “trace propagation 必须保持为 observability implementation concern”；design 决策 3、4
- [x] 2.2 增加 negative tests，实际触发 tracer/meter unavailable、attribute serialization failure、invalid label/value、propagation parse failure 或 projector exception，断言 TRACE / METRIC surface 只返回 degraded / failed_closed，不影响 LOG/AUDIT、request lifecycle、terminal commit 或用户可见结果。
  验证：新增 `packages/agent-observability/tests/trace-projector-negative.test.ts` 或等价测试；补充 projector host integration tests；`npm test -- trace-projector runtime-metrics trace-log-linking`
  来源：`otel-observability-adapter` Requirement “OTel adapter failures 必须有界且不阻塞主流程”；design 决策 1、2、5
- [x] 2.3 增加安全字段负向验证，实际断言 raw prompt、tool args/result、attachment content、path、credential、token、高基数字段、`traceId/spanId` 和未分类 candidate 不能进入 span attributes、metric labels 或 in-memory registry 直接输出的 observability log。
  验证：新增/补充 redaction、metrics-registry 与 trace projector tests；`npm test -- redaction-policy metrics-registry trace-projector runtime-metrics`
  来源：`otel-observability-adapter` Requirement “TraceProjector 必须只消费安全 observation 并映射到 OTel trace 语义”；design 决策 5、6

## 3. 集成验证与收尾

- [x] 3.1 运行 change 相关目标验证，确认 TRACE / OTel metrics adapter 与现有 observability 主路径兼容。
  验证：`npm run build`、`npm test`、`npm run lint:architecture`、`openspec validate --all --strict`
  来源：proposal 影响范围；design 验证映射
- [x] 3.2 清理实现引入的临时 helper、测试替身和未使用依赖，确认 `@opentelemetry/api` 已变为真实使用依赖，且不存在新的未使用 OTel 适配层残留。
  验证：`git diff --stat`、`rg -n "@opentelemetry|traceId|spanId" packages tests`、code review 检查未使用代码/依赖
  来源：proposal 范围；design 风险与取舍、迁移计划

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/otel-observability-adapter/spec.md`、`openspec/specs/trace-log-linking/spec.md` 和 `openspec/specs/agent-runtime-metrics/spec.md`。
- 按需更新 `openspec/designs/architecture/observability-boundaries.md`，沉淀 TRACE / OTel metrics adapter 的 owner、handoff、W3C / OTLP 语义和安全边界。
- 按需更新 `openspec/designs/modules/agent-observability.md` 与 `openspec/designs/modules/agent-app.md`，沉淀 adapter 实现与 composition 装配职责。
- 按需更新 `openspec/designs/adr/0001-ts-backend-stack.md` 与 `openspec/designs/spec-to-design-map.md`。
