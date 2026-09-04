## 1. 需求 1：去掉 OTLP trace exporter 的 pk/sk 认证

- [x] 1.1 修改 `createOtlpTraceProjector`：exporter 创建条件改为只检查 `endpoint`，不设置 `Authorization` header；`authPk`/`authSk` 字段保留但不影响创建逻辑。
  来源：`otel-trace-export` 的 "OTLP exporter 只需 endpoint 即可创建" + "OTel tracing 配置必须走 system config + SecretReference"
  验证：`npx vitest run packages/agent-observability/tests/otel-trace-infrastructure.test.ts --reporter=dot`

- [x] 1.2 修改 `preloadTraceComposition`：当 `injectedTraceProjector` 存在时直接透传，不存在时返回 `traceEnabled: false`；不再自行解析 endpoint 或调用 `createOtlpTraceInfrastructure`，避免与外部 OTel SDK 初始化冲突。
  来源：同上
  验证：`npx vitest run packages/agent-app/tests/runtime-tracing-config.test.ts --reporter=dot`；测试中引用旧 safeReasonCode 的用例 MUST 同步更新。

- [x] 1.4 精简 `default-system.yaml` 的 tracing 配置为只保留 `enabled: true`，去掉 `endpoint`/`authPkRef`/`authSkRef`/`serviceName`。
  来源：`otel-trace-export` 的 "OTel tracing 配置必须走 system config + SecretReference"
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/runtime-tracing-config.test.ts packages/agent-app/tests/system-config.test.ts --reporter=dot` 28/28 通过。

- [x] 1.3 修改 config 校验（`validation.ts`）：`validateTracingConfig` 放宽为只检查 tracing 是否存在或 enabled 是否为 false，不再要求三项齐全；`exporterConfigComplete` 改为只检查 `endpoint` 是否存在。
  来源：同上
  验证：`npx vitest run packages/agent-app/tests/system-config.test.ts --reporter=dot`

## 2. 需求 2：外部调用方通过 getExecutionCorrelation 注入 trace 上下文

- [x] 2.1 在 `RequestLifecycleCoordinator` 类上新增 `getExecutionCorrelation(): ExecutionCorrelationPort | undefined` 方法，返回 `this.deps.executionCorrelation`。不修改 `RuntimeCommandPort` 接口签名，不在 command 上加字段。
  验证：`npm run build --workspace @nextagent/agent-runtime` 通过；`withIncomingCarrier` 的行为已由 `packages/agent-observability/tests/timeline-span-lifecycle.test.ts` 覆盖（含合法/无效 carrier、root span 降级）。
  来源：`ts-core-contracts` 的 "外部调用方可通过 RuntimeCommandPort 获取 ExecutionCorrelationPort"
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot`（新增 getExecutionCorrelation 测试）

- [x] 2.2 `withIncomingCarrier` 注入 trace 上下文的行为由 `timeline-span-lifecycle.test.ts` 的 "preserves incoming W3C carrier" 和 "creates a root request span when the incoming traceparent is invalid" 测试覆盖。`getExecutionCorrelation()` 返回的 port 即 `TimelineSpanRegistry` 实例，无需重复测试。
  验证：`npx vitest run packages/agent-observability/tests/timeline-span-lifecycle.test.ts --reporter=dot` 10/10 通过。

- [x] 2.3 `getExecutionCorrelation()` 返回 `undefined` 时调用方直接调用 runtime 方法——这是调用方逻辑，不需 runtime 侧测试。`executionCorrelation` 未配置时 `withExecutionRef` 已有降级路径（`executeQueuedWork` 中 `this.deps.executionCorrelation === undefined ? execute() : ...`）。
  验证：`npm run build` 通过；现有 runtime 测试无回归。

- [x] 2.4 无效 traceparent 安全降级已由 `timeline-span-lifecycle.test.ts` 的 "creates a root request span when the incoming traceparent is invalid" 测试覆盖（全零 traceId、非法格式）。
  验证：`npx vitest run packages/agent-observability/tests/timeline-span-lifecycle.test.ts --reporter=dot` 10/10 通过。

- [x] 2.5 在 `request-runtime-composition.ts` 的 `createRequestLifecycleCoordinator` deps 顶层增加 `executionCorrelation: input.executionCorrelation`，确保 `getExecutionCorrelation()` 能正确返回。
  来源：`ts-core-contracts` 的 "外部调用方可通过 RuntimeCommandPort 获取 ExecutionCorrelationPort"
  验证：`npm run build --workspace @nextagent/agent-app` 通过。

## 3. 需求 3：gen_ai.* 属性映射层

- [x] 3.1 在 `trace-export-diagnostics.ts` 中新增 `applyGenAiAttributes(spans: ReadableSpan[]): ReadableSpan[]` 函数：按映射规则对每个 span 计算要追加的 `gen_ai.*` key，创建浅拷贝 span 对象并合并 attributes（不修改原始 `ReadableSpan`）；异常时返回原始 spans 数组。
  来源：`otel-trace-export` 的 "trace export 边界 MUST 追加 gen_ai.* 属性" + "映射不修改原始 ReadableSpan 对象" + "映射异常不阻止 export" scenarios
  验证：`npx vitest run packages/agent-observability/tests/ --reporter=dot`（新增 gen_ai 映射测试）

- [x] 3.2 修改 `instrumentTraceExporterDiagnostics` 的 export 包装：在调用原始 `exportSpans` 前调用 `applyGenAiAttributes` 处理 span 数组，将结果传给原始 exporter。
  来源：同上
  验证：同 3.1

- [x] 3.3 新增辅助 Span 映射测试：不包含 `nextagent.observation_type` 的 Span 只追加通用属性：不包含 `nextagent.observation_type` 的 Span 只追加通用属性（`gen_ai.agent.id`、`gen_ai.conversation.id` 等），不追加 `gen_ai.operation.name` 和 `gen_ai.response.status`。
  来源：`otel-trace-export` 的 "辅助 Span 只追加通用属性" scenario
  验证：同 3.1

- [x] 3.4 新增来源 key 缺失测试：Span 不包含 `nextagent.owner.agent_id` 时不追加 `gen_ai.agent.id`：Span 不包含 `nextagent.owner.agent_id` 时不追加 `gen_ai.agent.id`，其他存在的来源 key 对应的 `gen_ai.*` 属性仍被追加。
  来源：`otel-trace-export` 的 "缺少来源 key 时跳过对应 gen_ai key" scenario
  验证：同 3.1

- [x] 3.5 在 `timeline-span-lifecycle.ts` 的 `prepareStart` 中，span 创建后用 `setAttribute('_internal.parentSpanId', parent.spanId)` 存储 parentSpanId（替代之前的 `Object.defineProperty` 方案，后者在导出时被 SDK 覆盖）。
  来源：OTel SDK 在导出时覆盖 `Object.defineProperty` 设置的 `parentSpanId`。
  验证：`npx vitest run packages/agent-observability/tests/timeline-span-lifecycle.test.ts --reporter=dot` 10/10 通过。

- [x] 3.6 在 `trace-projector.ts` 的 `project()` 中，span 创建后用 `setAttribute('_internal.parentSpanId', parentSpanCtx.spanId)` 存储 parentSpanId（同 3.5 的 setAttribute 方案）。
  来源：同 3.5。
  验证：`npx vitest run packages/agent-observability/tests/trace-projector.test.ts packages/agent-observability/tests/trace-projector-negative.test.ts --reporter=dot` 全部通过。

- [x] 3.7 在 `timeline-span-lifecycle.ts` 的 `applyTerminalSpanState` 中，当 `MODEL_INVOCATION_COMPLETED` 事件到达时，从 `inlinePayload.usage` 提取 `inputTokens`/`outputTokens`/`totalTokens` 到 span 属性 `nextagent.usage.*`。
  来源：token usage 存在于 timeline payload 但未投影到 span attributes，导致 gen_ai.usage.* 映射无数据来源。
  验证：`npx vitest run packages/agent-observability/tests/timeline-span-lifecycle.test.ts --reporter=dot` 全部通过。

- [x] 3.8 更新 `trace-export-diagnostics.ts` 的 gen_ai 映射：model span 判断改为通过 `nextagent.usage.input_tokens`/`nextagent.usage.output_tokens` 存在性判断；补充 `gen_ai.usage.total_tokens`、`gen_ai.client.operation.duration`、`gen_ai.token.type`、`gen_ai.request.model`（从 `OPENAI_MODEL_NAME` 环境变量）映射。
  来源：生产验证发现原有映射缺失 model span 的 usage 和 duration 映射。
  验证：`npx vitest run packages/agent-observability/tests/gen-ai-attribute-mapping.test.ts --reporter=dot` 10/10 通过。

## 4. Change 整体验证

- [x] 4.1 完成全部门禁：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
  来源：proposal `影响范围`、design `验证策略`
  验证：全部通过
