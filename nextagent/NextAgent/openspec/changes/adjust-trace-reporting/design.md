## 设计范围

| 需求 | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| 1. 去认证 | OTLP exporter 只需 endpoint 即可创建 | `otel-trace-export` | 需求 1 |
| 2. 外部 trace 上下文注入 | runtime 暴露 getExecutionCorrelation 供外部调用方注入 | `ts-core-contracts`, `trace-log-linking` | 需求 2 |
| 3. gen_ai 属性映射 | export 边界追加 gen_ai.* attributes | `otel-trace-export` | 需求 3 |

## 需求 1：去掉 OTLP trace exporter 的 pk/sk 认证

### 目标

`OTLPTraceExporter` 的创建不再要求 `authPk`/`authSk`，只要有 `endpoint` 即可创建 exporter 并远程上报。config 校验同步放宽：`authPkRef`/`authSkRef` 不再被要求，但仍接受配置（向后兼容），只是不再强制。

### 当前实现

`createOtlpTraceProjector` 在 [otel-trace-infrastructure.ts](../../../packages/agent-observability/src/linking/otel-trace-infrastructure.ts) 中：

```ts
const exporter =
  options.endpoint === undefined || options.authPk === undefined || options.authSk === undefined
    ? undefined
    : new OTLPTraceExporter({
        url: options.endpoint,
        headers: { Authorization: `Basic ${Buffer.from(...).toString('base64')}` },
      });
```

三者之一缺失则不创建 exporter。config 校验（`validation.ts`）要求 endpoint、authPkRef、authSkRef "全部存在或全部缺失"。

`preloadTraceComposition` 在 [observability-composition.ts](../../../packages/agent-app/src/composition/observability-composition.ts) 中通过 `AppCredentialResolver` 解析三个 SecretReference，只有全部解析成功才传入 `exporterOptions`。

### 修改方案

1. **`createOtlpTraceProjector`**：exporter 创建条件改为 `options.endpoint === undefined ? undefined : new OTLPTraceExporter({ url: options.endpoint })`。不再传 `headers`。
2. **`OtlpTraceInfrastructureOptions`**：`authPk` 和 `authSk` 字段保留但不再影响 exporter 创建逻辑。
3. **`preloadTraceComposition`**：只解析 `endpoint`，不再要求解析 `authPkRef`/`authSkRef`。`exporterOptions` 只包含 `endpoint`。原有 `MISSING_ENDPOINT_OR_CREDENTIALS` safeReasonCode 变更为 `MISSING_ENDPOINT`，`CREDENTIAL_RESOLUTION_FAILED` 变更为 `ENDPOINT_RESOLUTION_FAILED`。现有测试中引用旧 safeReasonCode 的用例 MUST 同步更新。
4. **config 校验（`validation.ts`）**：`validateTracingConfig` 放宽为只检查 `tracing` 是否存在或 `enabled` 是否为 false，不再要求三项齐全。`exporterConfigComplete` 改为只检查 `endpoint` 是否存在。

### DFX 影响

| 质量属性 | 实现机制 | 验证关注点 |
|---|---|---|
| 安全 | 不携带 Basic Auth header；endpoint 仍走 SecretReference；spec 明确部署方需确保 endpoint 受网络层保护 | exporter 不含 Authorization header |
| 可维护性 | 减少配置依赖项 | 只配 endpoint 即可远程上报 |
| 兼容性 | authPkRef/authSkRef 字段保留不报错；旧 safeReasonCode 变更需同步测试 | 已有配置不阻断启动 |
| 可审计性 | config 变化通过 operational log 记录 `otel.trace.exporter.unavailable` 和 `otel.trace.init.completed` | 启动日志反映新配置状态 |

## 需求 2：外部调用方通过 getExecutionCorrelation 注入 trace 上下文

### 目标

外部调用方通过 `runtime.submit(command)` 和 `runtime.answerPendingInput(command)` 直接调用 runtime 层，不走 HTTP channel，因此不经过 Task Channel 的 `withIncomingCarrier` 路径。采用与 lvxiaoyang 的 Task Channel 实现相同的模式：runtime 暴露 `getExecutionCorrelation()` 方法，调用方获取 `ExecutionCorrelationPort` 后用 `withIncomingCarrier(carrier, operation)` 包裹 runtime 调用，将 W3C trace 上下文注入 `incomingCarrier` ALS。trace 信息不进入 runtime command 字段。

### 当前实现

- `RuntimeCommandPort` 接口定义 `submit`、`answerPendingInput` 等方法，不暴露 `executionCorrelation`。
- `RequestLifecycleCoordinator` 通过 `this.deps.executionCorrelation` 在内部使用 `withExecutionRef`，但不对外暴露。
- Task Channel 通过 `dependencies.executionCorrelation?.withIncomingCarrier(carrier, operation)` 包裹 runtime 调用，carrier 从 HTTP header 提取。

### 时序分析

`submit` 方法的执行路径：

1. `submit` 方法同步执行 session 创建、校验、`REQUEST_ACCEPTED` timeline event 写入（`emitEvent` → `appendEvent` → `prepareSafely` → `prepareStart`）
2. `enqueueWork` 把 work 放入 scheduler 队列
3. `submit` 方法返回
4. scheduler 异步通过 `void this.runSchedulerLoop()` → `dispatchReservedWork` → `executeQueuedWork` 执行

`withIncomingCarrier` 的 ALS 在步骤 3 返回后退出 scope。但 `incomingCarrier` 只在步骤 1 的 `prepareStart` 中被读取（用于创建 Request Span 的 parent），此时 ALS 仍在 scope 内。后续步骤 4 中子 Span 的 parent 通过 `requestSpanContext(requestRunId)` 从 registry 查找，不依赖 `incomingCarrier` ALS。

`answerPendingInput` 的 resume 路径不同——它在同一个 async chain 内直接 `await this.executeQueuedWork(...)`，ALS 可以传播。

结论：调用方在 `withIncomingCarrier` 回调内调用 `submit` 或 `answerPendingInput` 即可正确工作，无需修改 runtime 内部逻辑。

### 修改方案

唯一实现路径是在 `RequestLifecycleCoordinator` 类上新增 `getExecutionCorrelation()` 公共方法，返回 `this.deps.executionCorrelation`。该方法不修改 `RuntimeCommandPort` 接口签名（submit/answerPendingInput 方法签名不变），也不在 command 上加任何字段。

外部调用方使用方式：

```ts
const correlation = runtime.getExecutionCorrelation();
const execute = () => runtime.submit(command);
if (correlation === undefined || traceCarrier === undefined) {
  await execute();
} else {
  await correlation.withIncomingCarrier(traceCarrier, execute);
}
```

这与 lvxiaoyang 在 Task Channel 中的 `withIncomingTrace` 实现完全一致：
```ts
// Task Channel (lvxiaoyang)
function withIncomingTrace(deps, request, operation) {
  return deps.executionCorrelation?.withIncomingCarrier(traceCarrierFromRequest(request), operation) ?? operation();
}
```

区别仅在于 carrier 来源：Task Channel 从 HTTP header 提取，外部调用方直接构造 `W3CTraceCarrier`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 外部调用方可注入 trace 上下文 | runtime 不暴露 executionCorrelation | 无法获取 port |
| 不改变 command 或方法签名 | command 没有 traceContext 字段 | 保持不变 |
| 无效 traceparent 安全降级 | parseIncomingCarrier 已校验并返回 undefined | 已有机制，无需新增 |

### DFX 影响

| 质量属性 | 实现机制 | 验证关注点 |
|---|---|---|
| 安全 | trace carrier 只通过 withIncomingCarrier 注入 ALS，不进入 command/DiagnosticContext/DTO/Record | 不可信来源不覆盖 trace 上下文 |
| 兼容性 | getExecutionCorrelation 为新增方法，不传时行为不变 | 前端走 HTTP channel 路径不受影响 |
| 一致性 | 前端（HTTP channel）和外部（runtime method）最终都进同一 withIncomingCarrier | 两条路统一处理 |
| 可靠性 | withIncomingCarrier 失败不影响 submit 业务语义 | trace 注入异常不阻止请求执行 |

## 需求 3：gen_ai.* 属性映射层

### 目标

在 trace export 边界（`instrumentTraceExporterDiagnostics` 包装层）对每个 Span 的 attributes 做映射：读取已有 `nextagent.*` attributes，按 OpenTelemetry GenAI Semantic Conventions 规范追加对应的 `gen_ai.*` attributes。现有 `nextagent.*` 全部保留，不改动 span 创建逻辑。

### 当前实现

`instrumentTraceExporterDiagnostics` 在 [trace-export-diagnostics.ts](../../../packages/agent-observability/src/linking/trace-export-diagnostics.ts) 中包装 `exporter.export(spans, resultCallback)`，当前只做失败日志。Span 在 export 时已携带 `nextagent.*` attributes（由 `startAttributes`、`applyTerminalSpanState`、`traceAttributesFor` 设置）。

OTel SDK 的 `ReadableSpan` 接口中 `attributes` 为 `readonly`，不能直接修改原对象。

### 实现方式

由于 `ReadableSpan.attributes` 是 `readonly`，映射层不能原地修改。实现方式为：

1. 对每个 `ReadableSpan`，读取其 `attributes`
2. 按映射规则计算要追加的 `gen_ai.*` key-value 对
3. 创建一个浅拷贝 span 对象：`{ ...span, attributes: { ...span.attributes, ...genAiAttributes } }`
4. 将新的 span 数组传给原始 `exporter.export`

由于 `ReadableSpan` 的其他字段（name、kind、spanContext、startTime、endTime、status、duration 等）都是 `readonly`，浅拷贝只是把引用复制到新对象，不复制底层 attributes map（新对象引用合并后的 attributes）。这不会产生额外内存开销或副作用——原 span 对象被 GC 后，新对象持有的引用是唯一的。

### Span 类型判断

权威 Span（由 `TimelineSpanLifecycle` 创建）设置 `nextagent.observation_type`，值为 `request`/`model`/`tool`/`workflow_node`。辅助 Span（由 `TraceProjector` 创建）设置 `nextagent.boundary`（值为 `request_lifecycle`/`system`/`gateway_call` 等），但不设置 `nextagent.observation_type`。

映射规则：
- 有 `nextagent.observation_type` → 按 observation_type 映射 `gen_ai.operation.name` 和 `gen_ai.response.status`
- 无 `nextagent.observation_type` → 不设置 `gen_ai.operation.name` 和 `gen_ai.response.status`，但仍追加通用属性（`gen_ai.agent.id` 等）

### 映射规则

通用映射（所有 Span，来源 key 不存在时跳过）：

| 来源 key | 目标 key |
|---|---|
| `nextagent.owner.agent_id` | `gen_ai.agent.id` |
| `nextagent.owner.agent_version` | `gen_ai.agent.version` |
| `session.id` | `gen_ai.conversation.id` |
| `nextagent.usage.input_tokens` | `gen_ai.usage.input_tokens` |
| `nextagent.usage.output_tokens` | `gen_ai.usage.output_tokens` |

按 observation_type 的映射：

| observation_type | gen_ai.operation.name | outcome → gen_ai.response.status |
|---|---|---|
| `request` | `invoke_agent` | success→completed, failure→failed, canceled→cancelled |
| `model` | `chat` | 同上 |
| `tool` | `execute_tool` | 同上 |
| `workflow_node` | `invoke_workflow` | 同上 |
| 缺失 | 不设置 | 不设置 |

### 映射函数实现

映射逻辑集中在一个函数 `applyGenAiAttributes(spans: ReadableSpan[]): ReadableSpan[]`：

1. 遍历每个 span
2. 读取 `span.attributes['nextagent.observation_type']` 确定是否为权威 Span 及其类型
3. 构建通用 `gen_ai.*` attributes（只从已有 key 复制值）
4. 如有 observation_type，追加 `gen_ai.operation.name`（硬编码值）
5. 如有 `nextagent.outcome`，追加 `gen_ai.response.status`（值映射）
6. 创建浅拷贝 span 对象，合并 attributes
7. 返回新的 span 数组
8. 整个过程 try/catch，异常时返回原始 spans 数组（不追加 gen_ai.*）

### 已知限制

权威 Span（由 `TimelineSpanLifecycle` 的 `startAttributes` 创建）当前只设置 `nextagent.observation_type`、`nextagent.execution.kind` 和少量 nodeId/description/eventId 字段。`applyTerminalSpanState` 只在终态时设置 `nextagent.outcome`、`nextagent.duration_ms` 和 `nextagent.reason_code`。权威 Span **不设置** `nextagent.owner.agent_id`、`nextagent.owner.agent_version`、`session.id` 或 `nextagent.usage.*`——这些信息存在于 `RunTimelineEventRecord` 上但没有投影到 span attributes。因此 `gen_ai.agent.id`、`gen_ai.agent.version`、`gen_ai.conversation.id` 和 `gen_ai.usage.*` 对权威 Span 不可用，只对辅助 Span（由 `TraceProjector.traceAttributesFor` 创建）可用。

Model Span 的 `startAttributes` 也不含 modelId，因此 `gen_ai.request.model`、`gen_ai.request.temperature` 等参数在映射层同样不可用。

这不是映射层的缺陷，而是 span attributes 的数据来源限制。如需补充，需要单独 change 修改 `startAttributes` 和 `applyTerminalSpanState` 把 agent_id/session_id/usage/modelId 等字段投影到 span attributes。

### DFX 影响

| 质量属性 | 实现机制 | 验证关注点 |
|---|---|---|
| 安全 | 映射只读取已有安全 attributes，不引入 prompt/output/credential | gen_ai.* 不含敏感字段 |
| 可维护性 | 映射集中在一个函数，以后改规则只改一处 | 单一职责 |
| 非阻塞 | 映射异常不影响 export | 映射失败时 span 仍正常上报（只有 nextagent.* key） |
| 容量 | 每个 Span 最多追加 8 个 string/int 字段 | payload 增量可忽略 |

## 验证策略（Verification Strategy）

- **需求 1**：trace exporter 初始化测试验证只有 endpoint 时 exporter 被创建且不含 Authorization header；config 校验测试验证 endpoint 存在即通过，authPkRef/authSkRef 缺失不报错；旧 safeReasonCode 变更后测试同步更新。
- **需求 2**：runtime 测试验证 `getExecutionCorrelation()` 返回 `ExecutionCorrelationPort`；外部调用方通过 `withIncomingCarrier` 包裹 `submit`/`answerPendingInput` 注入 trace 上下文；`getExecutionCorrelation()` 返回 `undefined` 时直接调用；无效 traceparent 时安全降级为 root span。
- **需求 3**：trace export 测试验证 export 前的 span attributes 包含 `gen_ai.*` key 且 `nextagent.*` 保留；验证 outcome 值映射正确；验证辅助 Span 只追加通用属性；验证原始 `ReadableSpan` 对象不被修改；验证映射异常不阻止 export。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/otel-trace-export/spec.md`：归档时修改 exporter 认证 requirement（去掉 pk/sk 强制要求），新增 gen_ai 属性映射 requirement。
- `openspec/specs/ts-core-contracts/spec.md`：归档时新增 `RequestLifecycleCoordinator` 暴露 `getExecutionCorrelation()` 方法的 requirement。
- `openspec/specs/trace-log-linking/spec.md`：归档时明确通过 `getExecutionCorrelation` + `withIncomingCarrier` 注入的 trace carrier 不违反 DiagnosticContext 约束。
- 其他 baseline 文档：无变更。

## 风险与取舍（Risks / Trade-offs）

- **去掉认证**：trace 数据不再经过认证保护，需确保 endpoint 本身受网络层保护。这是调用方选择。
- **gen_ai 映射层在 export 边界**：如果未来 span attributes 结构变化（如增加新字段），映射函数需要同步更新。但由于映射只读取已知 key，遗漏不会导致错误，只是少一个 `gen_ai.*` 字段。
- **权威 Span 缺少 agent_id/session_id/usage**：当前 `startAttributes` 和 `applyTerminalSpanState` 不投影 `nextagent.owner.agent_id`、`session.id` 或 `nextagent.usage.*` 到权威 Span，因此 `gen_ai.agent.id`、`gen_ai.conversation.id` 和 `gen_ai.usage.*` 对权威 Span 不可用。通用映射仍对辅助 Span 生效。这是已知限制，不阻塞本 change，后续如需可单独 change 在 `startAttributes`/`applyTerminalSpanState` 补充这些字段。
- **Model Span 缺少 modelId**：当前 `startAttributes` 不含 modelId，所以 `gen_ai.request.model` 在映射层不可用。这是已知限制，不阻塞本 change，后续如需可单独 change 补充。
- **safeReasonCode 变更**：`MISSING_ENDPOINT_OR_CREDENTIALS` → `MISSING_ENDPOINT`，`CREDENTIAL_RESOLUTION_FAILED` → `ENDPOINT_RESOLUTION_FAILED`。现有测试和日志搜索需同步更新。
- **浅拷贝方式**：映射层创建浅拷贝 span 对象传给 exporter。如果未来 OTel SDK 版本升级改变了 `ReadableSpan` 接口或 export 内部行为，可能需要调整拷贝策略。

## 迁移与回滚（Migration / Rollback）

- 需求 1：已有配置中的 `authPkRef`/`authSkRef` 不需要删除，启动时被忽略。回滚到旧版本需要重新确保三者配置齐全。
- 需求 2：`getExecutionCorrelation()` 为新增方法，旧调用方不调用不受影响。回滚到旧版本后方法不存在，调用方需移除引用。
- 需求 3：映射层是纯追加行为，回滚后 `gen_ai.*` key 消失但 `nextagent.*` 原样保留。

## 待确认问题（Open Questions）

无。
