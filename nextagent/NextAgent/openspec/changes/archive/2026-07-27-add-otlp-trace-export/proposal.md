## 背景与问题（Why）

NextAgent 运行时已具备完整的可观测事件体系（ObservabilityObservationEvent），业务事件通过 ProjectorHost 分发给 LOG/AUDIT/METRIC 等 Projector 处理。TraceProjector 已有最小骨架实现，但缺少三层 Span 嵌套（REQUEST_ACCEPTED -> MODEL_INVOCATION -> CAPABILITY_INVOCATION）、observation_type 属性、SpanKind 映射和诊断日志。运行时入口缺少 OTel SDK 初始化代码，导致 trace.getTracer() 返回 NoopTracer，所有 Span 操作为空。多个 package.json 缺少 OTel SDK 依赖声明。OTel 端点和认证信息缺少统一的 config 和 SecretReference 管理路径。

需要实现：

1. 增强 TraceProjector：新增 resolveParentContext() 三层级联推衍、observation_type 属性映射、spanKindFor() SpanKind 映射、emitDiagnostic() 诊断日志
2. 新增 currentOtelSpanId() 函数供业务代码获取当前 OTel Span ID
3. 在 system config 的 observability 段新增 tracing 配置项（endpoint、authPkRef、authSkRef、serviceName），认证 key 走 SecretReference 与 model profile credential 一致
4. 在一个运行时入口（agent-app local-runtime-package）从 systemConfig 读取 tracing 配置，通过 credentialResolver 解析认证 key，初始化 OTel SDK（NodeTracerProvider + OTLPTraceExporter + BatchSpanProcessor）
5. 将 traceProjector 注入 App 创建函数，注册到 ProjectorHost 的 fixed projector set
6. 补齐 2 个 package.json 的 OTel SDK 依赖声明

## 变更范围（What Changes）

- `agent-app/src/config/component-config.ts`：在 observability 段新增 tracing 配置（endpoint、authPkRef、authSkRef、serviceName）
- `agent-app/config/default-system.yaml`：新增 observability.tracing 默认配置段
- `agent-app/src/config/validation.ts`：校验 tracing 配置项的 SecretReference 格式
- `agent-observability/src/linking/trace-projector.ts`：增强 TraceProjector，新增 rootSpanContexts/modelInvocationContexts 两个 bounded-by-active-run Map、resolveParentContext()、observation_type 属性、spanKindFor()和injected RuntimeLogger failure evidence
- `agent-observability/src/linking/otel-trace-infrastructure.ts`：owning concrete OTel SDK/exporter composition和safe export failure mapping
- `agent-observability/src/linking/context.ts`：新增 currentOtelSpanId() 函数
- `agent-observability/package.json`：新增 6 个 OTel SDK 依赖（sdk-trace-base、sdk-trace-node、exporter-trace-otlp-http、resources、propagator-b3、semantic-conventions）
- `agent-app/package.json`：保持无 concrete OTel trace SDK dependency
- `agent-app/src/local-runtime-package/index.ts`：新增 config/credential selection + operational-writer-first traceProjector 注入

## Capability 影响（Capabilities）

### 新增 Capability
- `otel-trace-export`：将已 redaction 的 ObservabilityObservationEvent 按 OpenTelemetry 1.9 语义映射为 OTLP traces span 并导出到外部轨迹中心。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- `packages/agent-app/src/config` 的 system config schema 和 validation
- `packages/agent-app/config/default-system.yaml` 的默认配置
- `packages/agent-observability` 的 TraceProjector 和 context helper
- `packages/agent-app` 的 local-runtime-package 入口和 package.json
- `packages/agent-observability` 的 package.json
- 覆盖 TraceProjector span 产出、层级推衍、属性映射、config 校验和 SDK 初始化的测试

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/otel-trace-export/spec.md`：新增，归并 OTel SDK 初始化、TraceProjector 层级推衍、observation_type/SpanKind 映射和 OTLP 导出的行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/modules/agent-observability.md`：修改，补充 TraceProjector 层级推衍和 SDK 初始化的设计落点。
- `openspec/designs/spec-to-design-map.md`：归档时补充 `otel-trace-export` 的导航条目。

验证入口：
- `packages/agent-observability/tests/trace-projector.test.ts`
- `packages/agent-observability/tests/otel-context.test.ts`
- `packages/agent-app/tests` 中 config validation 测试
