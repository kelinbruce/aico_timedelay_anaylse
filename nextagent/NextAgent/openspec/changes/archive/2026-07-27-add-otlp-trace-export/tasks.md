## 1. system config tracing 配置

- [x] 1.1 在 agent-app/src/config/component-config.ts 的 observability 段新增 tracing 配置项（endpoint: SecretReference、authPkRef: SecretReference、authSkRef: SecretReference、serviceName?: string），在 RawDefaultSystemConfig 中同步新增。
  验证：TypeScript 编译通过；config 类型检查覆盖新增字段。
  来源：Requirement "OTel tracing 配置必须走 system config + SecretReference"。
- [x] 1.2 在 agent-app/src/config/validation.ts 中校验 tracing 配置项的 SecretReference 格式（env: 或 file:），在 default-system.yaml 中新增 observability.tracing 默认占位段。
  验证：config validation 测试覆盖合法/非法 SecretReference 格式并通过；default-system.yaml 包含 tracing 段。
  来源：Requirement "OTel tracing 配置必须走 system config + SecretReference"。

## 2. currentOtelSpanId()

- [x] 2.1 在 agent-observability/src/linking/context.ts 新增 currentOtelSpanId() 函数，使用动态 require + try-catch 获取 @opentelemetry/api 并返回当前 span ID。
  验证：packages/agent-observability/tests/otel-context.test.ts 覆盖 SDK 可用和不可用场景并通过。
  来源：Requirement "currentOtelSpanId() 必须安全获取当前 Span ID"。

## 3. 运行时入口 OTel SDK 初始化

- [x] 3.1 在 agent-app local-runtime entrypoint 中完成 credential resolution 和 traceProjector 注入；在 agent-observability owning OTel SDK/exporter composition，并通过唯一 operational writer输出 bounded init/export/projection degradation evidence。
  验证：代码审查确认缺值跳过逻辑；无 NATRACE/console/raw endpoint/credential/error bypass；traceProjector 仅在配置完整时注入；exporter 失败诊断覆盖且成功 batch 不逐次记录。
  来源：Requirement "缺值时必须跳过 trace 上报"；Requirement "运行时入口必须初始化 OTel SDK"。

## 4. TraceProjector 增强

- [x] 4.1 新增 resolveParentContext()，实现 REQUEST_ACCEPTED -> MODEL_INVOCATION -> CAPABILITY_INVOCATION 三层 Span 嵌套，维护 rootSpanContexts、modelInvocationContexts 和 spanContextsBySpanId 三个 Map。project() 创建 span 后将 span context 同步写入对应 Map。
  验证：packages/agent-observability/tests/trace-projector.test.ts 覆盖三层嵌套场景并通过。
  来源：Requirement "TraceProjector 必须实现三层 Span 嵌套"。
- [x] 4.2 新增 observation_type 属性映射和 spanKindFor() SpanKind 映射，在 project() 中设置到 span attributes 和 startSpan options。同时新增 input.value（safeSummary）和 output.value（outcome + safeReasonCode）属性映射，供轨迹中心 UI 显示 span 的输入摘要和输出结果。
  验证：trace-projector.test.ts 断言 model_invocation=CLIENT/model、capability_invocation=CLIENT/tool、gateway_call=SERVER/gateway、request_lifecycle=INTERNAL/request；断言 input.value 等于 safeSummary，output.value 包含 outcome；断言 traceLinksFor 从 diagnosticCandidates 解析 traceparent 并作为 OTel Link 关联。
  来源：Requirement "每个 span 必须设置 observation_type 和 SpanKind"。
- [x] 4.3 修改 covers() 在 requestRunId 分组模式下过滤没有 requestRunId 的孤立事件。
  验证：trace-projector.test.ts 断言无 requestRunId 的事件 covers() 返回 false。
  来源：Requirement "TraceProjector 必须实现三层 Span 嵌套"。
- [x] 4.4 新增 emitDiagnostic() 输出 TRACE_SPAN 和 TRACE_SPAN_ERROR 诊断日志，含 tracerConstructor、spanId、requestRunId 字段。
  验证：trace-projector.test.ts 断言诊断日志被调用。
  来源：Design "质量属性 - 审计/可追溯性"。

## 5. package.json 依赖声明

- [x] 5.1 在 agent-observability/package.json 新增 6 个 OTel SDK 依赖（sdk-trace-base、sdk-trace-node、exporter-trace-otlp-http、resources、propagator-b3、semantic-conventions）。
  验证：npm install 无缺失。
  来源：Requirement "OTel SDK 依赖必须在 package.json 显式声明"。
- [x] 5.2 architecture gate确认 agent-app 不直接依赖 OTel trace SDK，全部 concrete SDK dependencies由 agent-observability owning。
  验证：npm install 无缺失。
  来源：同上。

## 6. 验证

- [ ] 6.1 运行 build、定向测试、contract 测试和 architecture lint。
  验证：npm run build、vitest run --config vitest.config.release.ts packages/agent-observability/tests/、npm run test:contract、npm run lint:architecture 通过。
  来源：AGENTS.md 验证门禁；Design "验证映射"。
  归档复验：定向测试（12 files / 40 tests）、contract（35 files / 301 tests）和 architecture（37 files / 229 tests）通过；全量 build 被既有 `packages/agent-workflow/tests/workflow-cancel-e2e.test.ts` 测试夹具缺少 `IdentityContext.displayName` 阻塞，未为归档修改该无关测试代码。
- [x] 6.2 运行 openspec strict 验证。
  验证：openspec validate add-otlp-trace-export --strict 通过。
  来源：AGENTS.md 验证门禁。

## 归档前更新基线检查（非实施任务）

归档前依据 proposal 和 design，将稳定的行为契约同步至 openspec/specs/otel-trace-export/spec.md，并更新 openspec/designs/modules/agent-observability.md 和 spec-to-design-map.md 的长期设计文档。
