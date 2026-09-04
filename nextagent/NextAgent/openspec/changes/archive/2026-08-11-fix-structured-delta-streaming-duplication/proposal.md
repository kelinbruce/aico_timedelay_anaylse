## 背景与问题（Why）

### 问题 1：流式 ApiCall 终态聚合数据重复发送

非 agentic ApiCall 流式执行时，每个 SSE chunk 已经通过 `TOOL_STRUCTURED_DELTA`（结构化）或 `CAPABILITY_RESULT_DELTA`（非结构化）逐条发给前端。流式结束后，编排层（`default-agent.ts`）将所有 chunk.data 原样拼接为 `aggregatedStreamData`，`JSON.stringify` 后作为 `terminalContent`，再通过 `LLM_CONTENT_DELTA { final: true }` 重发一遍。同时 `CAPABILITY_RESULT_DELTA` 也携带同一份聚合数据。前端收到同一份数据三次（逐条 + 最终 LLM_CONTENT_DELTA + 最终 CAPABILITY_RESULT_DELTA），导致重复渲染。

### 问题 2：流式 TOOL_STRUCTURED_DELTA 不持久化，刷新后丢失

当前持久化策略中，非 workflow 的 `TOOL_STRUCTURED_DELTA` 是 `LIVE_ONLY`。非流式场景下前端靠 `CAPABILITY_RESULT` message 反推结构化内容（message payload 是 `{ eventType, messageType, content }`，`resolveStructuredDeltaEnvelope` 能匹配），已在远端验证通过。但流式场景下 `appendCapabilityResultMessage` 存的是 `{ result: aggregatedStreamData }`（原始拼接字符串），`identifyStructuredDelta({ result: "chunk1chunk2..." })` 不匹配，前端无法重建，刷新后结构化内容丢失。

### 问题 3：tool-loop.ts 路径 emitResultDelta 回调缺少 structuredPayload 解包

model 通过 tool call 主动调用 ApiCall 时，`executor.ts` 桥接层把 tool 的 `emitResultDelta({ structuredPayload: parsed_json })` 转发为 `runtimeContext.emitResultDelta({ structuredPayload: { structuredPayload: parsed_json } })`，多包了一层。`default-agent.ts` 的回调做了 `structuredPayload?.['structuredPayload'] ?? structuredPayload` 手动解包，但 `tool-loop.ts` 的回调没有，导致 `tryEmitStructuredDelta` 收到的是 `{ structuredPayload: parsed_json }` 而非 `parsed_json` 本身，结构化格式永远不匹配。

## 变更范围（What Changes）

1. **Per-chunk 结构化识别与终态抑制**：流式过程中每条 chunk 独立判断——匹配结构化格式发 `TOOL_STRUCTURED_DELTA`（带 `streaming: true` 标记），不匹配发 `CAPABILITY_RESULT_DELTA`（per-chunk, LIVE_ONLY）。流式结束后，只对非结构化 chunk 的聚合数据发 `LLM_CONTENT_DELTA { final: true }`；全部结构化时不发。流式结束后的 `CAPABILITY_RESULT_DELTA` 跳过。

2. **流式 TOOL_STRUCTURED_DELTA 持久化**：流式 emit 时在 `inlinePayload` 中加 `streaming: true` 标记。修改 `runTimelineEventPersistencePolicy`，新增规则将带 `streaming: true` 的 `TOOL_STRUCTURED_DELTA` 持久化为 `PERSISTED`。非流式 `TOOL_STRUCTURED_DELTA`（无 `streaming` 标记）保持 `LIVE_ONLY` 不变，继续走 message 反推。前端 history replay 对流式场景从 timeline store 直接读取，非流式场景继续走反推，两条路径互不干扰。

3. **tool-loop.ts 解包修复**：在 `tool-loop.ts` 的 `emitResultDelta` 回调中加入 `structuredPayload?.['structuredPayload'] ?? structuredPayload` 解包，与 `default-agent.ts` 保持一致。同时统一 `CAPABILITY_RESULT_DELTA` 的 `result` 字段为解包后的值。

## 决策点

### D1. 终态 LLM_CONTENT_DELTA 只承载非结构化残留

流式结束后：
- 有非结构化 chunk → `LLM_CONTENT_DELTA { final: true }` 只包含非结构化 chunk 的聚合数据
- 全部结构化 → 不发 `LLM_CONTENT_DELTA`
- `terminalContent` 保留原值给 `assertTerminalContentReady` 和 terminal commit 用，仅影响 emit 行为

### D2. 终态 CAPABILITY_RESULT_DELTA 跳过

流式结束后的 `CAPABILITY_RESULT_DELTA` 携带聚合数据，与 per-chunk delta 重复，且前端投影后 `detailText` 为空。跳过后 live 场景由 per-chunk delta + `CAPABILITY_COMPLETED` 覆盖，model context 由 `CAPABILITY_RESULT` message 覆盖。

### D3. 只针对流式做持久化，非流式不动

非流式场景的反推机制已在远端验证通过，贸然改动风险大。本次只对流式 `TOOL_STRUCTURED_DELTA` 做持久化。区分方式：流式 emit 时在 `inlinePayload` 中加 `streaming: true` 标记，持久化规则只匹配该标记。非流式 `TOOL_STRUCTURED_DELTA` 无此标记，保持 `LIVE_ONLY` + 反推不变。两条路径独立，不需要前端去重逻辑。

### D4. streaming 标记的影响面

`streaming: true` 是低基 boolean，只被持久化策略读取。流投影层（`stream-envelope.ts`）对 `TOOL_STRUCTURED_DELTA` 按字段白名单提取，`streaming` 不在白名单中，SSE/WebSocket envelope 不包含它。前端 live stream 和 history replay 均无感知。诊断日志不违反 redaction 约束。

### D5. tool-loop.ts 解包修复范围

仅修复 `emitResultDelta` 回调中的 `structuredPayload` 解包，不改动 `executor.ts` 桥接层的包装行为。解包逻辑与 `default-agent.ts` 完全一致。

## Capability 影响（Capabilities）

### 修改的 Capability

## Function 影响（OpenSpec Capabilities）

### 修改的 Capability

- `tool-structured-delta`（`FN-*`，canonical spec：`tool-structured-delta`）：新增流式终态抑制（全部结构化时跳过 LLM_CONTENT_DELTA，混合时只发非结构化残留）、流式 TOOL_STRUCTURED_DELTA 持久化（streaming 标记 + PERSISTED 规则）、tool-loop emitResultDelta 解包修复、CAPABILITY_RESULT_DELTA result shape 一致性。涉及系统质量属性：可靠性/恢复（刷新后流式结构化内容不丢失）、可维护性（非流式路径不受影响）。

### 新增 Capability

无。

## 影响范围（Impact）

- `packages/agent-core/src/agent/default-agent.ts`：流式 `emitResultDelta` 回调中跟踪结构化/非结构化 chunk；流式结束后条件性抑制 `LLM_CONTENT_DELTA` 和 `CAPABILITY_RESULT_DELTA`；流式 `TOOL_STRUCTURED_DELTA` emit 时加 `streaming: true`。
- `packages/agent-core/src/tools/tool-loop.ts`：`emitResultDelta` 回调中加入 `structuredPayload` 解包；`CAPABILITY_RESULT_DELTA` 的 `result` 字段统一为解包后的值。
- `packages/agent-core/src/tools/structured-delta-identification.ts`：`emitStructuredDeltaData` 和 `tryEmitStructuredDelta` 支持 `streaming` 标记透传到 `inlinePayload`。
- `packages/agent-runtime/src/timeline/event-persistence-policy.ts`：新增 `streaming: true` 的 `TOOL_STRUCTURED_DELTA` → `PERSISTED` 规则。
- `packages/agent-core/tests/`：新增流式终态抑制测试、持久化策略测试、tool-loop 解包测试。
- `frontend/agent-web/`：无改动（流式持久化事件通过现有 timeline replay 机制自动读取，不需要前端代码变更）。

## Non-Goals

- 不改非流式 `TOOL_STRUCTURED_DELTA` 的持久化策略和 message 反推逻辑。
- 不改 `executor.ts` 桥接层的 `structuredPayload` 包装行为。
- 不改 `structured-delta-safety.ts`。
- 不改 `structured-delta-identification.ts` 的识别逻辑（只加 `streaming` 标记透传）。
- 不改 live stream 的 per-chunk emit 行为。
- 不改 `CAPABILITY_RESULT` message 的存储格式。
- 不改前端代码。
- 不处理跨帧累积拼接的流式场景。
