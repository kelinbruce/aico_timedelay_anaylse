## 1. 核心执行器

- [x] 1.1 在 `agent-workflow/src/nodes/capability-nodes.ts` 的 `executeRestfulNode()` 中新增 SSE 路由
  - 先解析 `stream_type`（`readRestfulStreamType`）：值为 `"sse"` 时进入 SSE 分支；空/未设置视为未启用；其他值抛出 `invalidNodeInput`，`field` 为 `"stream_type"`
  - SSE 分支在 `batchConfig` 分支**之前**执行互斥检查（spec M1/M2 要求冲突时报错，不能静默走 batch 分支）：
    - 若 `batchConfig !== undefined`，抛出 `invalidNodeInput`，`field` 为 `"stream_type + batchInputDataItem"`
    - 若 `is_long_api === true`，抛出 `invalidNodeInput`，`field` 为 `"stream_type + is_long_api"`
  - 路由到新函数 `executeRestfulSSE()`
  验证：`npm run build` 通过
  来源：spec `Restful SSE Stream Type` S1, `Restful SSE Mutual Exclusion` M1/M2, `Restful SSE Non-Streaming Compatibility` N2

- [x] 1.2 在 `agent-workflow/src/nodes/capability-nodes.ts` 新增 `executeRestfulSSE()` 函数
  - `stream_type` 已加入 `RESTFUL_CONTROL_FIELDS`，由 `resolveRestfulArgs()` 统一从参数中过滤（与 `api_name` 等基础设施字段一致）
  - 创建 `CapabilityInvocationRuntimeContext`，包含：
    - `emitPolicyApplied: async () => {}`
    - `emitResultDelta: async (payload) => { ... }` 将 payload.structuredPayload 序列化为 JSON，调用 `context.emitOutputDelta({ channel: "DSL", content: json + "\n", level: "DETAIL" })`
  - 调用 `capabilityInvocation.invoke()` 并传入上述 runtimeContext
  - 使用 `capabilityResultPayload()` 处理最终结果
  - 返回 `{ outputVariables: projectNodeOutputs(outputs, { api_response: payload, invocation_trace: trace }) }`
  验证：`npm run build` 通过
  来源：spec `Restful SSE Stream Type` S1, `Restful SSE Stream Delta Emission` D1, `Restful SSE Aggregated Result` A1

## 2. 投影升级

- [x] 2.1 在 `agent-core/src/agent/workflow-runtime-event-projector.ts` 的 `isCapabilityLikeWorkflowNode()` 中添加 `RESTFUL`
  - 修改为：`return nodeType === "TOOL" || nodeType === "SKILL" || nodeType === "SUBFLOW" || nodeType === "RESTFUL";`
  验证：`npm run build` 通过
  来源：design 投影路径升级

- [x] 2.2 在 `agent-core/src/agent/workflow-runtime-event-projector.ts` 的 `workflowCapabilityIdentity()` 中添加 RESTFUL 分支
  - 在 `event.nodeType === "SUBFLOW"` 分支后添加：
    ```
    : event.nodeType === "RESTFUL"
      ? readString(inputs, "api_name") ?? event.nodeId
    ```
    验证：`npm run build` 通过
    来源：design 投影路径升级

- [x] 2.3 在 `agent-core/src/agent/workflow-runtime-event-projector.ts` 中为 RESTFUL 节点产出 `CAPABILITY_RESULT_DELTA` 实时投递聚合结果
  - 新增 `buildCapabilityResultDelta()`：`{ type: "CAPABILITY_RESULT_DELTA", persistence: "LIVE_ONLY", inlinePayload: { capabilityId, toolCallId, result: resolveVisibleOutput(event), ...workflowFields } }`
  - 在 `projectCapabilityNodeEvent()` 的 `NODE_COMPLETED` case 中，当 `event.nodeType === "RESTFUL" && event.output !== undefined && displayControl.showContent` 时，在 `CAPABILITY_COMPLETED` 前追加该事件
  - ⚠️ **不向 `CAPABILITY_COMPLETED` 添加 `output`**：timeline 持久化策略 `hasRecoverableContent` 拒绝可恢复内容（`TIMELINE_EVENT_PERSISTENCE_INVALID`，frozen contract），聚合结果持久化由 `TOOL_STRUCTURED_DELTA`（PERSISTED）承担
  验证：`npm run build` 通过；测试验证 `CAPABILITY_RESULT_DELTA` 为 LIVE_ONLY 且携带 `result`，`CAPABILITY_COMPLETED` 保持 body-free
  来源：design `projectCapabilityNodeEvent` 修改（修正版）

## 3. 测试

- [x] 3.1 在 `agent-workflow/tests/workflow-capability-nodes.test.ts` 新增 SSE 流式测试
  - 测试用例 1：SSE 流式调用正常完成，验证 emitOutputDelta 被逐个调用，api_response 包含聚合结果
  - 测试用例 2：stream_type 从 capability 参数中过滤（不传给 CLIP）
  - 测试用例 3：capability 未提供 emitResultDelta 时降级（无流式 delta，聚合结果仍返回）
  - 测试用例 4：SSE + batchInputDataItem 互斥，验证抛出 WORKFLOW_NODE_INPUT_INVALID
  - 测试用例 5：SSE + is_long_api 互斥，验证抛出 WORKFLOW_NODE_INPUT_INVALID
  - 测试用例 6：未知 stream_type 值，验证抛出 WORKFLOW_NODE_INPUT_INVALID
  - 测试用例 7：stream_type 为空时保持现有行为
  验证：`npm run test` 通过
  来源：spec `Restful SSE Stream Type` S1, `Restful SSE Mutual Exclusion` M1/M2, `Restful SSE Stream Delta Emission` D2, `Restful SSE Non-Streaming Compatibility` N1/N2

- [x] 3.2 在 `agent-core/tests/workflow-runtime-event-projector.test.ts` 更新 RESTFUL 投影断言
  - 更新现有 RESTFUL 测试用例，RESTFUL 纳入 capability-like（`capabilityKind: TOOL`）、完成事件拆分为 `CAPABILITY_RESULT_DELTA` + `CAPABILITY_COMPLETED`
  - 新增 SSE 流式 delta 投影测试：NODE_OUTPUT_DELTA with level "DETAIL" + channel "DSL" → TOOL_STRUCTURED_DELTA（累积内容，api_name 标识）
  - 新增 SSE 节点完成投影测试：NODE_COMPLETED → CAPABILITY_RESULT_DELTA（LIVE_ONLY，携带 result）+ CAPABILITY_COMPLETED（body-free）
  - 新增 RESTFUL 身份测试：`api_name` 作为 capabilityId
  - `timeline-event-persistence-policy.test.ts` 新增 workflow 形状 `CAPABILITY_RESULT_DELTA` → LIVE_ONLY 用例
  验证：`npm run test` 通过
  来源：design 投影路径升级（修正版）

## 4. 验证

- [x] 4.1 运行全量测试验证
  - `npm run build` 通过
  - `npm test` 通过（受影响包全量 + 全仓默认套件；browser/remote-deployment 4 项既有环境失败与本次无关，基线复现确认）
  - `npm run test:contract` 通过
  - `npm run lint:architecture` 通过
  - `openspec validate add-restful-sse-streaming --strict` 通过
  来源：验证入口
