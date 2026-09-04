## 背景和现状（Context）

TraceProjector 已有最小骨架：covers() 过滤 boundary/operation 组合、project() 创建 span 并设置 status/event/attributes。但它使用 ROOT_CONTEXT 作为所有 span 的父上下文，不产生层级嵌套；不设置 SpanKind；不映射 observation_type；不输出诊断日志。运行时入口未初始化 OTel SDK，trace.getTracer() 返回 NoopTracer。OTel 端点和认证信息缺少统一的 config 和 SecretReference 管理路径，现有 model profile credential 走 env:VAR_NAME / file:/path 格式的 SecretReference，由 AppCredentialResolver 统一解析和校验。3 个 package.json 缺少 OTel SDK 依赖声明。

现有 otel-observability-adapter spec 已定义 TraceProjector 的安全约束。本变更在此基础上实现 SDK 初始化和层级推衍，不修改安全约束。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 system config 的 observability 段新增 tracing 配置项（endpoint、authPkRef、authSkRef、serviceName），认证 key 走 SecretReference
- 在 agent-app local-runtime-package 从 systemConfig 读取 tracing 配置并通过 credentialResolver 解析认证 key；agent-observability owning OTel SDK/exporter composition
- endpoint、authPkRef、authSkRef 任一未配置时跳过初始化，不上报 trace
- 增强 TraceProjector 实现 REQUEST_ACCEPTED -> MODEL_INVOCATION -> CAPABILITY_INVOCATION 三层 Span 嵌套
- 为每个 span 设置 observation_type 和 SpanKind
- 新增 currentOtelSpanId() 供业务代码获取当前 OTel Span ID
- 补齐 2 个 package.json 的 OTel SDK 依赖声明

**非目标：**
- 不修改 ObservabilityObservationEvent 的 shape 或 redaction 策略
- 不修改 ProjectorHost 的 dispatch 逻辑或 queue 策略
- 不修改 LOG/AUDIT/METRIC/HEALTH projector 的行为
- 不引入 metric export（仅 trace export）
- 不修改 gateway implementation 或 business package 的调用方式

## 设计决策（Decisions）

### OTel tracing 配置走 system config + SecretReference

在 default-system.yaml 的 observability 段新增 tracing 子段：

```yaml
observability:
  logging:
    redaction: "normal"
  tracing:
    endpoint: "env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
    authPkRef: "env:OTEL_AUTH_PK"
    authSkRef: "env:OTEL_AUTH_SK"
    serviceName: "nextagent"
```

- endpoint：OTLP traces 端点 URL，使用 env:VAR_NAME 格式的 SecretReference。
- authPkRef/authSkRef：Basic Auth 用户名和密码，使用 SecretReference（env: 或 file:），由 AppCredentialResolver 解析。
- serviceName：服务名，默认 nextagent，非敏感字符串，直接配置。

这套方案与 model profile 的 credentialRef: "env:OPENAI_API_KEY" 完全一致，认证 key 在启动时走 AppCredentialResolver 的 validate/resolve 路径，支持 env: 和 file: 两种 reference 格式。

### 缺值跳过逻辑

agent-app entrypoint 从 systemConfig 读取 tracing 配置后，检查 endpoint、authPkRef、authSkRef 三个字段：
- 三个字段全部已配置且 resolve 成功 -> 初始化 SDK，创建 traceProjector
- 任一字段未配置或 resolve 失败 -> 通过唯一 operational writer输出 bounded safe reason/安全异常证据，跳过初始化，traceProjector 为 undefined；不输出字段名、字段值或 raw error

这确保未配置 trace 上报的环境不会因缺少配置而启动失败，也确保认证信息不完整时不会发出无认证的 trace 请求。

### 入口选择配置，agent-observability owning SDK composition

唯一 operational writer 必须先于 OTel SDK 初始化。agent-app entrypoint only owning config/credential selection；agent-observability owning concrete NodeTracerProvider、BatchSpanProcessor、OTLPTraceExporter、export failure mapping与 TraceProjector。这样保持 OTel SDK 不泄漏到 app composition，并让 init/export/projection failure统一走 component RuntimeLogger；SDK 初始化 failure不得阻断启动。

### 三层 Span 嵌套通过 requestRunId 分组

TraceProjector 内部维护两个 Map：rootSpanContexts（requestRunId -> REQUEST_ACCEPTED span context）和 modelInvocationContexts（requestRunId -> 最新 MODEL_INVOCATION span context）。resolveParentContext() 基于 boundary 推衍父子关系。covers() 在 requestRunId 分组模式下过滤没有 requestRunId 的孤立事件，避免产生无父 span。

### observation_type 和 SpanKind 映射

observation_type 是低基数标签：model_invocation -> model，capability_invocation -> tool，request_lifecycle -> request，gateway_call -> gateway，system -> system。SpanKind 遵循 OTel 语义：model_invocation/capability_invocation -> CLIENT，gateway_call -> SERVER，其他 -> INTERNAL。

### currentOtelSpanId() 使用动态 require

使用动态 require + try-catch 获取 @opentelemetry/api。如果 API 不存在，返回 undefined 而不阻断 agent-observability 包的加载。

### OTel SDK 依赖声明策略

传递依赖（propagator-b3、semantic-conventions）由 agent-observability 显式声明；初始化失败统一映射为 `TRACE_SDK_INITIALIZATION_FAILED`，不得输出 raw loader error。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 认证 key 走 SecretReference，由 AppCredentialResolver 解析；span 属性仅使用低基数安全字段。 | config validation 测试 + TraceProjector 测试 |
| 性能/容量 | BatchSpanProcessor 定时批量导出，不阻塞主流程；SDK 不可用时返回 NoopTracer。 | 集成测试 |
| 可靠性/恢复 | 缺值跳过不阻断启动；SDK 初始化失败只打印日志；TraceProjector 抛异常返回 degraded。 | 缺值跳过测试 + TraceProjector 异常测试 |
| 可维护性 | SDK 初始化代码集中在入口文件；tracing 配置走统一 config 路径。 | 代码审查 |
| 可测试性 | covers/project/resolveParentContext/traceAttributesFor/spanKindFor 可独立单元测试。 | Vitest 定向测试 |
| 审计/可追溯性 | emitDiagnostic 输出 TRACE_SPAN 日志含 tracerConstructor、spanId、requestRunId。 | 诊断日志断言 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| tracing config schema 和 SecretReference 校验 | 1.1-1.2 | config validation 测试 |
| 缺值跳过逻辑 | 3.1 | 入口代码审查 + bounded operational safe reason |
| 三层 Span 嵌套正确 | 4.1-4.3 | trace-projector.test.ts |
| observation_type 和 SpanKind 映射 | 4.2, 4.4 | 同上 |
| currentOtelSpanId() 安全降级 | 5.1 | otel-context.test.ts |
| SDK 初始化失败不阻断启动 | 3.1 | 入口代码审查 |
| package.json 依赖完整 | 5.1-5.2 | npm install 无缺失 |
| 安全约束无回归 | 6.1 | npm run test:contract、npm run lint:architecture |

## 文档承载决策（Documentation Ownership）

- 行为契约：openspec/specs/otel-trace-export/spec.md
- 模块设计：openspec/designs/modules/agent-observability.md 补充设计落点
- ADR：无
- 导航：openspec/designs/spec-to-design-map.md 归档时补充

## 风险与取舍（Risks / Trade-offs）

- [OTel SDK 依赖不可消减] -> propagator-b3、semantic-conventions 显式声明。
- credential selection仅在 agent-app local-runtime-package；concrete SDK/exporter composition仅在 agent-observability。
- [rootSpanContexts/modelInvocationContexts 内存增长] -> 首版不清理，后续可增加 TTL 或在 TERMINAL_COMMITTED 时清理。

## 迁移计划（Migration Plan）

无数据迁移。OTel tracing 配置在 default-system.yaml 中默认提供占位配置段。endpoint/authPkRef/authSkRef 任一未配置时跳过初始化并输出 bounded safe reason，不影响现有部署。配置后自动开始 trace export。

## 归档前更新基线（Baseline Promotion Plan）

- openspec/specs/otel-trace-export/spec.md：归并 SDK 初始化、层级推衍和 OTLP 导出的行为契约。
- openspec/designs/modules/agent-observability.md：补充 TraceProjector 层级推衍和 SDK 初始化的设计落点。
- openspec/designs/spec-to-design-map.md：归档时补充导航条目。

## 待确认问题（Open Questions）

无。
