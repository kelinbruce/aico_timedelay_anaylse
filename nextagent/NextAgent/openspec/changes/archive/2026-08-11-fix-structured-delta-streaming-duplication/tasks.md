## 1. tool-loop.ts 解包修复

- [x] 1.1 在 `packages/agent-core/src/tools/tool-loop.ts` 的 `emitResultDelta` 回调中加入 `const sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload` 解包，后续 `tryEmitWorkflowToolDelta` / `tryEmitStructuredDelta` / `CAPABILITY_RESULT_DELTA` 的 `result` 字段统一使用 `sdiCandidate`。
  验证：TypeScript 编译通过；`tool-structured-delta-emission.test.ts` 现有测试不回归。
  满足：Requirement "tool-loop emitResultDelta Structured Payload Unwrap"。

- [x] 1.2 新增测试：tool-loop 路径 ApiCall 流式 chunk 结构化识别。mock `capabilityInvocation.invoke` 发出 `{ eventType, messageType, content }` 结构化 delta，断言 `TOOL_STRUCTURED_DELTA` 被 emit。
  验证：`vitest run` 新测试通过。
  满足：Requirement "tool-loop emitResultDelta Structured Payload Unwrap"。

## 2. default-agent.ts 终态抑制 + streaming 标记

- [x] 2.1 在 `packages/agent-core/src/agent/default-agent.ts` 两条 non-agentic 路径的 `emitResultDelta` 回调中维护 `streamDeltaTotal`、`streamDeltaStructured` 计数器和 `nonStructuredParts` 收集器。
  验证：TypeScript 编译通过。
  满足：Requirement "Streaming Terminal LLM_CONTENT_DELTA Suppression"。

- [x] 2.2 流式结束后，`allStructured` 为 true 时跳过 `LLM_CONTENT_DELTA` emit；为 false 时只对 `nonStructuredParts` 聚合后 emit `LLM_CONTENT_DELTA`。同时跳过流式结束后的 `CAPABILITY_RESULT_DELTA`。
  验证：TypeScript 编译通过。
  满足：Requirement "Streaming Terminal LLM_CONTENT_DELTA Suppression"、"Streaming Terminal CAPABILITY_RESULT_DELTA Suppression"。

- [x] 2.3 `default-agent.ts` 的 `emitResultDelta` 回调非结构化 fallback 分支 `result` 字段从 `structuredPayload` 改为 `sdiCandidate`，消除多包一层的问题。
  验证：TypeScript 编译通过。
  满足：Requirement "CAPABILITY_RESULT_DELTA Result Shape Consistency"。

- [x] 2.4 新增 characterization 测试：全部结构化 chunk 时不发 `LLM_CONTENT_DELTA`；部分非结构化时只发非结构化聚合；`CAPABILITY_COMPLETED` 始终正常发出。
  验证：`vitest run` 新测试通过。
  满足：Requirement "Streaming Terminal LLM_CONTENT_DELTA Suppression"。

## 3. streaming 标记透传

- [x] 3.1 在 `packages/agent-core/src/tools/structured-delta-identification.ts` 中给 `tryEmitStructuredDelta` 和 `emitStructuredDeltaData` 加可选参数 `streaming?: boolean`，透传到 `emitEvent` 的 `inlinePayload.streaming`。非流式场景不传该参数。
  验证：TypeScript 编译通过；`structured-delta-identification.test.ts` 现有测试不回归。
  满足：Requirement "Streaming TOOL_STRUCTURED_DELTA Persistence Marker"。

- [x] 3.2 在 `default-agent.ts` 和 `tool-loop.ts` 的 `emitResultDelta` 回调中，调用 `tryEmitStructuredDelta` 时传 `streaming: true`（仅流式 ApiCall 路径）。
  验证：TypeScript 编译通过。
  满足：Requirement "Streaming TOOL_STRUCTURED_DELTA Persistence Marker"。

## 4. 流式 TOOL_STRUCTURED_DELTA 持久化

- [x] 4.1 在 `packages/agent-runtime/src/timeline/event-persistence-policy.ts` 中新增规则：`TOOL_STRUCTURED_DELTA` + `inlinePayload.streaming === true` → `PERSISTED`。插入位置在 workflow PERSISTED 规则之后、LIVE_ONLY catch-all 之前。
  验证：TypeScript 编译通过；现有持久化策略测试不回归。
  满足：Requirement "Streaming TOOL_STRUCTURED_DELTA Persistence"。

- [x] 4.2 新增/扩展测试：`streaming: true` 的 `TOOL_STRUCTURED_DELTA` 被判定为 `PERSISTED`；无 `streaming` 标记的非流式 `TOOL_STRUCTURED_DELTA` 仍为 `LIVE_ONLY`；workflow `NODE_OUTPUT_DELTA` fragment 仍为 `LIVE_ONLY`；workflow `NODE_COMPLETED` 仍为 `PERSISTED`。
  验证：`vitest run packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts` 通过。
  满足：Requirement "Streaming TOOL_STRUCTURED_DELTA Persistence"。

## 5. 验证和审查

- [x] 5.1 运行 `npm run build`、`npm test`、`npm run lint:architecture`。
  验证：全量门禁通过。
  满足：AGENTS.md 验证门禁。

- [x] 5.2 运行 `openspec validate fix-structured-delta-streaming-duplication --strict`。
  验证：strict 验证通过。
  满足：AGENTS.md OpenSpec 验证。

- [x] 5.3 运行 `$nextagent-code-review` 检视提交范围。
  验证：检视结论 PASS 或 PASS WITH FOLLOW-UP。
  满足：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后：
- `openspec/specs/tool-structured-delta/spec.md`：新增流式终态抑制、流式持久化、tool-loop 解包、result shape 一致性 requirement；更新持久化策略描述（非流式 LIVE_ONLY + 反推不变，流式 PERSISTED 新增）。
