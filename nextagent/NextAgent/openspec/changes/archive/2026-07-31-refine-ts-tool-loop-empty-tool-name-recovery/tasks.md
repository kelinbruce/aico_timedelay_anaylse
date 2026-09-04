# 任务：优化 TS tool loop 空 tool-name 恢复

## 1. 实现

- [x] 1.1 `packages/agent-core/src/tools/tool-loop.ts`：新增 `hasEmptyToolName(toolCalls)`、`buildEmptyToolNameCorrectionMessage(toolCalls, attempt)`、`buildToolCallBatchLogEntries(toolCalls, rawToolInput)` exports。新增 `toBrandedCapabilityId` 辅助函数，空名时回退到 `brand("unknown")`，确保日志字段永不抛错。
- [x] 1.2 `packages/agent-core/src/tools/tool-loop.ts`：在 `executeToolCallsInOrder` 中、`TOOL_CALL_LIMIT_EXCEEDED` guard 之后且 `appendAssistantToolUseMessage` 之前新增防御性兜底 guard；发出 `tool.loop.empty_tool_name` warn 日志、`DEGRADATION_NOTICE(TOOL_NAME_EMPTY)`，并抛出 `TOOL_NAME_EMPTY`。
- [x] 1.3 `packages/agent-core/src/agent/default-agent.ts`：import 新辅助函数；新增 `consecutiveEmptyToolNameRetries` 计数器；在超限 else 分支之后、`executeToolCallsInOrder` 之前新增恢复块；在未检测到空名的 else 分支中重置计数器。

## 2. 测试

- [x] 2.1 `tests/agent-kernel/tool-loop.test.ts`：新增 e2e characterization 测试 "recovers when the model returns a tool call with an empty tool name and continues the loop"——断言 `TOOL_NAME_EMPTY` DEGRADATION_NOTICE、`REQUEST_COMPLETED`、无 `CAPABILITY_STARTED`、无 `REQUEST_FAILED`。
- [x] 2.2 `tests/agent-kernel/tool-loop.test.ts`：新增 e2e 测试 "stops the run safely after the empty-tool-name recovery limit is exhausted"——断言 `TOOL_NAME_EMPTY`、`REQUEST_FAILED`、无 `REQUEST_COMPLETED`、无 `CAPABILITY_STARTED`。

## 3. 验证

- [x] 3.1 `npm run build --workspace @nextagent/agent-core` 通过（无 TS 错误）。
- [x] 3.2 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/tool-loop.test.ts`——18/18 通过（含 2 个新测试）。
- [x] 3.3 通过 `runtimeLogs: "file"` demo 验证真实 warn 日志输出：`tool.loop.empty_tool_name_recoverable` 携带 toolCallId、toolName（空）、安全参数快照。
