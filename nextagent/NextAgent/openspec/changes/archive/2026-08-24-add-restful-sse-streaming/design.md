## 当前实现基线（Current Implementation）

### RESTFUL 节点执行路径

`executeRestfulNode()` 位于 `agent-workflow/src/nodes/capability-nodes.ts`，当前支持三种模式：

1. **同步调用**：`capabilityInvocation.invoke()` 等待完整结果
2. **长轮询**（`is_long_api`）：循环调用直到完成或超时
3. **批处理**（`batchInputDataItem`）：serial/parallel 执行多组参数

三种模式均使用 `createWorkflowCapabilityRuntimeContext()` 创建 runtime context，该 context 仅提供 `emitPolicyApplied: async () => {}`，**不提供 `emitResultDelta`**。

### CLIP subscribe 机制

CLIP 工具源（`agent-capability/src/clip/clip-tool-source.ts`）支持 `subscribe` 原语：
- `buildClipExecutionArgs()` 在 `primitive === "subscribe"` 时追加 `--format jsonl`
- `sandbox-clip-command-runner.ts` 创建 `ClipStreamDeltaEmitter`，通过 `executeWithStdoutChunks` 逐帧解析 SSE
- 每个解析后的帧通过 `emitResultDelta` 回调触发
- 最终 `parseClipExecutionOutput()` 聚合完整结果

### 投影路径

`WorkflowRuntimeEventProjector`（`agent-core/src/agent/workflow-runtime-event-projector.ts`）当前将 RESTFUL 归为 generic 节点：
- `projectGenericNodeEvent()` 只处理 `NODE_STARTED` 和 `NODE_COMPLETED`
- `NODE_OUTPUT_DELTA` 返回空数组（不产生流式事件）
- `isCapabilityLikeWorkflowNode()` 只包含 `TOOL`、`SKILL`、`SUBFLOW`

## 目标设计（Target Design）

### 新增 SSE 执行路径

在 `executeRestfulNode()` 中新增路由：

```
executeRestfulNode()
  ├── stream_type === "sse"? → 互斥检查 → executeRestfulSSE()
  ├── batchConfig?           → executeRestfulBatch()
  ├── is_long_api?           → executeRestfulLongTaskPolling()
  └── 默认                   → 同步 invoke
```

互斥检查逻辑：当 `stream_type === "sse"` 时，若 `batchConfig !== undefined` 或 `is_long_api === true`，抛出 `WORKFLOW_NODE_INPUT_INVALID`。

### executeRestfulSSE 实现

```typescript
async function executeRestfulSSE(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  resolved: Record<string, unknown>,
  capabilityId: string,
  trace: JsonObject,
  resolvedSecretValues: readonly string[]
): Promise<WorkflowNodeHandlerResult> {
  const capabilityInvocation = requireCapabilityInvocation(options.capabilityInvocation);
  const args = omitKeys(resolved, ["api_name", "stream_type"]);

  const runtimeContext: CapabilityInvocationRuntimeContext = {
    emitPolicyApplied: async () => {},
    emitResultDelta: async (payload) => {
      const content = JSON.stringify(payload.structuredPayload);
      await context.emitOutputDelta({
        channel: "DSL",
        content: content + "\n",
        level: "DETAIL"
      });
    }
  };

  const result = await capabilityInvocation.invoke(
    buildCapabilityInvocationRequest(context, capabilityId, asJsonObject(args)),
    context.signal,
    runtimeContext
  );

  const payload = capabilityResultPayload(result, trace, resolvedSecretValues);
  return {
    outputVariables: projectNodeOutputs(context.node.outputs, {
      api_response: payload,
      invocation_trace: trace
    })
  };
}
```

### 投影路径升级

将 RESTFUL 加入 capability-like 节点投影，使流式 `NODE_OUTPUT_DELTA` 能被正确处理。同时保持 `CAPABILITY_COMPLETED` 携带输出数据以支持持久化。

#### isCapabilityLikeWorkflowNode 修改

在 `WorkflowRuntimeEventProjector` 中添加 `RESTFUL`：

```
return nodeType === "TOOL" || nodeType === "SKILL" || nodeType === "SUBFLOW" || nodeType === "RESTFUL";
```

效果：`projectBase()` 对 RESTFUL 节点走 `projectCapabilityNodeEvent()` 路径。

#### workflowCapabilityIdentity 修改

添加 RESTFUL 分支以读取 `api_name` 作为 capabilityId：

```
event.nodeType === "RESTFUL"
  ? readString(inputs, "api_name") ?? event.nodeId
```

#### projectCapabilityNodeEvent 修改

⚠️ **关键修正（相对初稿）**：初稿提出 RESTFUL 的 `CAPABILITY_COMPLETED` 携带 `output` 以持久化聚合结果。该方案与 timeline 持久化策略冲突：`event-persistence-policy.ts` 的 `hasRecoverableContent()` 明确拒绝 `CAPABILITY_COMPLETED`（含 workflow 生命周期事件）携带 `content`/`output`/`result` 等可恢复内容，命中即抛 `TIMELINE_EVENT_PERSISTENCE_INVALID`（`timeline-event-persistence-policy.test.ts` 有显式断言）。因此：

- `CAPABILITY_COMPLETED` 对 RESTFUL 也保持 **body-free**（与其他 capability-like 节点一致）
- 聚合结果的**实时投递**改由新增 `CAPABILITY_RESULT_DELTA`（LIVE_ONLY，`result: output`）承担
- 聚合结果的**持久化**继续由 `projectStructuredDelta` 的 `TOOL_STRUCTURED_DELTA`（PERSISTED，NODE_COMPLETED 携带完整输出内容）承担

在 `projectCapabilityNodeEvent()` 的 `NODE_COMPLETED` case 中，RESTFUL 节点额外产出 `CAPABILITY_RESULT_DELTA`：

```typescript
case "NODE_COMPLETED":
  if (!displayControl.showTitle && !displayControl.showContent) {
    return [];
  }
  return [
    ...(event.nodeType === "RESTFUL" && event.output !== undefined && displayControl.showContent
      ? [this.buildCapabilityResultDelta(event, identity)]
      : []),
    {
      type: "CAPABILITY_COMPLETED",
      inlinePayload: this.attachWorkflowFields(event, {
        capabilityKind: identity.capabilityKind,
        capabilityId: identity.capabilityId,
        toolCallId: identity.toolCallId,
        status: "SUCCEEDED",
        durationMs: durationMs(event.startedAt, event.completedAt),
      })
    }
  ];
```

新增 `buildCapabilityResultDelta()`：

```typescript
private buildCapabilityResultDelta(event, identity): RunTimelineEvent {
  return {
    type: "CAPABILITY_RESULT_DELTA",
    persistence: "LIVE_ONLY",
    inlinePayload: this.attachWorkflowFields(event, {
      capabilityId: identity.capabilityId,
      toolCallId: identity.toolCallId,
      result: this.resolveVisibleOutput(event),
    }, lifecycleProjectionOptions)
  };
}
```

`CAPABILITY_RESULT_DELTA` 的 LIVE_ONLY 持久化规则只校验 `capabilityKind`/`targetCapabilityId`/`resultProjectionKind`，不校验可恢复内容，因此 `result` 字段合法（新增 policy 测试用例覆盖 workflow 形状）。

### 流式事件投影路径

```
SSE 事件到达
  → emitResultDelta({ structuredPayload: {...} })
  → context.emitOutputDelta({ channel: "DSL", content: "<json>\n", level: "DETAIL" })
  → WorkflowEngine.emitNodeOutputDelta → NODE_OUTPUT_DELTA
  → Projector.project() 快路径 (level !== undefined)
  → TOOL_STRUCTURED_DELTA (LIVE_ONLY)
```

### 最终结果投影路径

```
CLIP subscribe 完成
  → invoke() 返回 CapabilityInvocationResult { structuredPayload: { events, completion } }
  → capabilityResultPayload() 提取 structuredPayload → { api_response, invocation_trace }
  → return { outputVariables: { api_response, invocation_trace } }
  → WorkflowEngine emits NODE_COMPLETED { output: { api_response, invocation_trace } }
  → Projector.project():
    │
    ├── projectBase() → projectCapabilityNodeEvent()
    │   ├── CAPABILITY_RESULT_DELTA (LIVE_ONLY, result: output)   ← 实时投递聚合结果
    │   └── CAPABILITY_COMPLETED (PERSISTED, body-free 状态元数据)
    │
    └── projectStructuredDelta() → TOOL_STRUCTURED_DELTA (PERSISTED)
        └── content: 累积流式 JSON Lines 文本 / 序列化聚合结果
```

### 持久化分布

| 存储位置 | 事件 | 内容 | 用途 |
|---------|------|------|------|
| Timeline store | `TOOL_STRUCTURED_DELTA` (PERSISTED) | 累积的 SSE JSON Lines 文本 + NODE_COMPLETED 时序列化的聚合结果 | 展示回放与结果持久化 |
| Live stream | `TOOL_STRUCTURED_DELTA` (LIVE_ONLY) | 逐条 SSE 事件 | 实时展示 |
| Live stream | `CAPABILITY_RESULT_DELTA` (LIVE_ONLY) | `result: { api_response, invocation_trace }` | 实时结果投递 |

> 说明：workflow RESTFUL 节点不产生 `CAPABILITY_RESULT` session message（该机制属于 tool-loop 路径，workflow 事件只走 timeline）。聚合结果作为下游输入由 handler 返回的 `outputVariables.api_response` 提供，与 timeline 事件相互独立。

### stream_type 字段处理

- DSL 中使用 snake_case `stream_type`，handler 直接读取 `resolved.stream_type`
- 无需 YAML 输入规范化（与 `api_name`、`is_long_api` 等字段一致）
- `executeRestfulSSE()` 中通过 `omitKeys(resolved, ["api_name", "stream_type"])` 过滤基础设施字段
- `stream_type` 只允许值 `"sse"`，其他值抛出 `WORKFLOW_NODE_INPUT_INVALID`

### 超时处理

复用 RESTFUL 节点的总超时时间（`context.node.timeout` → `nodeTimeoutMs()`），由 `WorkflowEngine` 的 node-level signal 控制。CLIP sandbox 进程和 SSE 连接均受此信号约束。

## 设计决策（Decisions）

1. **emitResultDelta 直接接 context.emitOutputDelta**：不引入中间缓冲区或聚合器，每个 SSE 事件直接透传为 `NODE_OUTPUT_DELTA`。聚合由 CLIP 层在 invoke 返回时完成。

2. **channel: "DSL" + level: "DETAIL"**：SSE 事件是结构化 JSON 数据，使用 `DSL` channel 语义准确。`level: "DETAIL"` 触发 projector 的结构化流式快路径，产生 `TOOL_STRUCTURED_DELTA`。

3. **RESTFUL 加入 capability-like，但 CAPABILITY_COMPLETED 保持 body-free**：加 `isCapabilityLikeWorkflowNode` 使 RESTFUL 获得 capability 标识（`capabilityId: api_name`、`capabilityKind: TOOL`）与流式 delta 投影能力；聚合结果经 `CAPABILITY_RESULT_DELTA`（LIVE_ONLY）实时投递、经 `TOOL_STRUCTURED_DELTA`（PERSISTED）持久化。`CAPABILITY_COMPLETED` 不得携带 `output`——timeline 持久化策略（`hasRecoverableContent`）拒绝可恢复内容，携带即抛 `TIMELINE_EVENT_PERSISTENCE_INVALID`（frozen contract，有既有测试断言）。

4. **不修改 CLIP 层**：SSE 流式能力已完整存在于 CLIP subscribe 原语中，RESTFUL 节点只需接入 `emitResultDelta` 回调即可获得流式能力。

5. **stream_type 值校验**：仅允许 `"sse"`，其他值立即报错。保持简单，未来扩展（如 WebSocket）通过新值而非通配符。

## 安全与合规（Security / Compliance）

- SSE 事件通过 `emitResultDelta` 透传，不绕过 capability 治理
- `stream_type` 作为普通 input 字段，不引入新的安全边界
- 流式事件通过 `LIVE_ONLY` 投影，不持久化中间状态
- 最终结果通过 `CAPABILITY_COMPLETED` 持久化，遵循现有审计路径
- 超时由 runtime signal 控制，无无限连接风险

## 性能与容量（Performance / Capacity）

- 每个 SSE 事件触发一次 `context.emitOutputDelta`，产生一次 `NODE_OUTPUT_DELTA` 事件
- 高频事件场景下，事件数量与 SSE 事件数成正比
- `TOOL_STRUCTURED_DELTA` 的 `LIVE_ONLY` 事件不写入持久化，仅传递给活跃订阅者
- 最终聚合结果在 `invoke()` 返回时一次性产生，不增加持久化开销

## 可维护性与可测试性（Maintainability / Testability）

- `executeRestfulSSE()` 是独立函数，可独立测试
- 测试 mock `capabilityInvocation.invoke()` 的 `emitResultDelta` 回调即可验证流式行为
- 投影升级可通过现有 projector 测试框架验证
- 互斥检查逻辑简单，边界条件清晰
