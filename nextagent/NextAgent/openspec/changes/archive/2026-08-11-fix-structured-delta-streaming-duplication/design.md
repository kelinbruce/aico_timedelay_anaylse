## Context

本 change 修复三个相关问题，它们共同导致流式 ApiCall 的结构化数据在前端重复展示或刷新后丢失。

### 当前事件流（non-agentic ApiCall 流式路径）

```
SSE chunk1 → emitResultDelta → tryEmitStructuredDelta → TOOL_STRUCTURED_DELTA (LIVE_ONLY)
SSE chunk2 → emitResultDelta → tryEmitStructuredDelta → TOOL_STRUCTURED_DELTA (LIVE_ONLY)
...
流式结束:
  CAPABILITY_RESULT_DELTA (result: { result: aggregatedStreamData })  ← 冗余
  CAPABILITY_COMPLETED
  terminalContent = JSON.stringify({ result: aggregatedStreamData })
  LLM_CONTENT_DELTA { final: true, content: terminalContent }          ← 冗余
```

前端收到同一份结构化数据两次（per-chunk TOOL_STRUCTURED_DELTA + 最终 LLM_CONTENT_DELTA），加上一次无渲染价值的 CAPABILITY_RESULT_DELTA。

### 当前持久化状态

`runTimelineEventPersistencePolicy`:
```
TOOL_STRUCTURED_DELTA + isQualifiedWorkflowProductPayload → PERSISTED
TOOL_STRUCTURED_DELTA + (catch-all)                      → LIVE_ONLY
```

非 workflow 的 TOOL_STRUCTURED_DELTA 不持久化。History replay 依赖 `CAPABILITY_RESULT` message 反推：
- 非流式直接形状/信封形状：message payload 是 `{ eventType, messageType, content }` 或信封 → `resolveStructuredDeltaEnvelope` 匹配 → 重建 ✓（已在远端验证）
- 流式：message payload 是 `{ result: "chunk1chunk2..." }` → `resolveStructuredDeltaEnvelope` 不匹配 → 无法重建 ✗

### tool-loop.ts 解包缺陷

`executor.ts` 桥接层：
```js
emitResultDelta: async (payload: JsonObject) => {
  await runtimeContext.emitResultDelta?.({ structuredPayload: payload });
}
```
tool 的 `emitResultDelta({ structuredPayload: parsed_json })` 经桥接后变成 `{ structuredPayload: { structuredPayload: parsed_json } }`。

`default-agent.ts` 回调做了手动解包：
```js
const _sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload;
```
`tool-loop.ts` 回调没有，`tryEmitStructuredDelta` 收到 `{ structuredPayload: parsed_json }`，无 `eventType`/`messageType`/`content`，永远不匹配。

## Goals / Non-Goals

**Goals**

- 流式结束后只对非结构化残留发 `LLM_CONTENT_DELTA`，全部结构化时跳过
- 流式结束后跳过冗余的 `CAPABILITY_RESULT_DELTA`
- 流式 `TOOL_STRUCTURED_DELTA` 持久化到 timeline store（非流式不动）
- 修复 tool-loop.ts 解包 bug
- 统一 `CAPABILITY_RESULT_DELTA` 的 `result` shape

**Non-Goals**

- 不改非流式 `TOOL_STRUCTURED_DELTA` 的持久化策略和 message 反推逻辑
- 不改 executor.ts 桥接层
- 不改 structured-delta-identification.ts 的识别逻辑
- 不改 structured-delta-safety.ts
- 不改 CAPABILITY_RESULT message 存储格式
- 不改 live stream per-chunk emit 行为
- 不改前端代码
- 不做前端去重（流式走持久化、非流式走反推，两条路径独立）

## Decisions

### 决策 1：终态抑制实现方式

编排层（`default-agent.ts`）在 `emitResultDelta` 回调中维护：
- `streamDeltaTotal`：流式 chunk 总数
- `streamDeltaStructured`：被 `tryEmitStructuredDelta` 成功识别的结构化 chunk 数
- `nonStructuredParts: string[]`：非结构化 chunk 的 data

流式结束后：
```js
const allStructured = streamDeltaTotal > 0 && streamDeltaTotal === streamDeltaStructured;
if (!allStructured) {
  const nonStructuredAggregated = nonStructuredParts.join('');
  await emitEvent({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: nonStructuredAggregated } });
}
// CAPABILITY_RESULT_DELTA 跳过（不再 emit）
```

`terminalContent` 保留原值 `JSON.stringify(apiResult.structuredPayload)` 给 `assertTerminalContentReady` 和 terminal commit 用，不受影响。抑制仅影响 `LLM_CONTENT_DELTA` 和 `CAPABILITY_RESULT_DELTA` 的 emit。

两条 non-agentic 路径（Pre 和 main）都适用。tool-loop.ts 路径不涉及 `LLM_CONTENT_DELTA`（由 model round 产生 terminal content），只需修复解包。

### 决策 2：只针对流式做持久化，非流式不动

非流式场景的反推机制已在远端验证通过，贸然改动风险大。本次只对流式 `TOOL_STRUCTURED_DELTA` 做持久化。

区分方式：流式 emit 时在 `inlinePayload` 中加 `streaming: true` 标记。持久化策略新增规则：
```
TOOL_STRUCTURED_DELTA + streaming=true              → PERSISTED  (新增)
TOOL_STRUCTURED_DELTA + isQualifiedWorkflowProduct   → PERSISTED  (不变)
TOOL_STRUCTURED_DELTA + (catch-all)                  → LIVE_ONLY  (不变，非流式照旧反推)
```

非流式 `TOOL_STRUCTURED_DELTA` 无 `streaming` 标记，走 catch-all → `LIVE_ONLY`，继续走 message 反推。两条路径独立，不需要前端去重。

### 决策 3：streaming 标记的影响面分析

`streaming: true` 只被持久化策略读取，其他所有消费方忽略它：

- **流投影层**（`stream-envelope.ts:512`）：对 `TOOL_STRUCTURED_DELTA` 按字段白名单提取（`toolEventType`, `toolMessageType`, `content`, `capabilityId`, `toolCallId`, `workflowEventType` 等），`streaming` 不在白名单中，SSE/WebSocket envelope 不包含它。
- **前端 live stream**：读取 envelope payload 的 `toolEventType`/`toolMessageType`/`content`，忽略未知字段。
- **前端 history replay**：timeline store 存完整 `inlinePayload`（含 `streaming: true`），但读出后经 `projectStreamPayload` 投影，`streaming` 被丢弃。前端拿到的 envelope 和 live stream 一致。
- **诊断日志**：`streaming: true` 是低基 boolean，不敏感，不违反 redaction 约束。
- **`hasUnexpectedWorkflowProductBody`**：检查的字段列表是 `['text', 'reasoning', 'delta', 'arguments', 'input', 'output', 'result', 'safeResult', 'structuredPayload']`，`streaming` 不在里面，不破坏 workflow PERSISTED 规则。

### 决策 4：tool-loop.ts 解包修复

在 `tool-loop.ts` 的 `emitResultDelta` 回调中（约 line 947）加入解包：

```js
emitResultDelta: async (payload) => {
  const structuredPayload = payload.structuredPayload ?? {};
  const sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload;  // ← 新增
  // ... 后续 tryEmitWorkflowToolDelta / tryEmitStructuredDelta 用 sdiCandidate
  // ... CAPABILITY_RESULT_DELTA 的 result 字段也用 sdiCandidate
}
```

同时 `default-agent.ts` 的 `emitResultDelta` 回调非结构化 fallback 分支 `result` 字段从 `structuredPayload`（多包一层）改为 `sdiCandidate`，与 tool-loop.ts 保持一致。

### 决策 5：streaming 标记的传递路径

`streaming: true` 从编排层传递到 `inlinePayload` 的路径：

1. `default-agent.ts` 的 `emitResultDelta` 回调中，`tryEmitStructuredDelta` 成功时调用 `emitStructuredDeltaData`
2. `emitStructuredDeltaData`（`structured-delta-identification.ts`）在 `emitEvent` 的 `inlinePayload` 中加入 `streaming: true`
3. `tool-loop.ts` 的 `emitResultDelta` 回调中，`tryEmitStructuredDelta` 成功时同样调用 `emitStructuredDeltaData`

实现方式：给 `tryEmitStructuredDelta` 和 `emitStructuredDeltaData` 加一个可选参数 `streaming?: boolean`，透传到 `inlinePayload.streaming`。非流式场景不传该参数，`inlinePayload` 无 `streaming` 字段。

## 架构约束

- 持久化策略变更不影响 workflow 路径：workflow `TOOL_STRUCTURED_DELTA` 的 PERSISTED/LIVE_ONLY 规则不变，新规则只匹配 `streaming: true` 事件。
- 持久化策略变更不影响非流式路径：非流式 `TOOL_STRUCTURED_DELTA` 无 `streaming` 标记，走 catch-all → LIVE_ONLY，反推逻辑不变。
- terminal commit 不受影响：`terminalContent` 保留原值，`assertTerminalContentReady` 和 terminal commit 正常工作。
- model context 不受影响：`CAPABILITY_RESULT` message 存储格式和内容不变。
- 前端不需要改动：流式持久化事件通过现有 timeline replay 机制自动读取，非流式继续走反推。
