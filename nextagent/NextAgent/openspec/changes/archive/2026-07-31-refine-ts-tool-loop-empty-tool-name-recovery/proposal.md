# 提案：优化 TS tool loop 空 tool-name 恢复

## 背景（Background）

当模型返回的 tool call 的 `toolName` 是空字符串（trim 之后）时，当前 `executeToolCallsInOrder` 路径会进入 `prepareToolCall`，把空值 brand 成 `CapabilityId`（`brand()` 会抛出 `INVALID_BRAND_VALUE`），run 以一个不透明的 safe error 终止。模型永远不会得知自己遗漏了 tool name，run 也无法自我纠正。这在较小或指令遵循能力较弱的模型上尤其常见——它们会发出不带 function name 的 tool-call envelope。

## 变更范围（What Changes）

为空 tool-name 的 tool call 增加防御性恢复，镜像既有的超限（`TOOL_CALL_LIMIT_EXCEEDED`）恢复形态：

1. `DefaultAgent` 在超限预检查之后、`executeToolCallsInOrder` 之前检测 `hasEmptyToolName(toolCalls)`。当连续空名重试计数低于 `toolCallLimitRecoveryLimit`（3）时，发出 `DEGRADATION_NOTICE`（code `TOOL_NAME_EMPTY`），发出携带模型返回 tool call 信息（toolCallId、toolName、安全参数快照）的 `tool.loop.empty_tool_name_recoverable` warn 日志，注入一条模型可见的 USER 纠正消息，并在不执行、不持久化空名批次的情况下重新进入模型轮次。
2. `executeToolCallsInOrder` 增加防御性兜底 guard，在恢复次数耗尽时抛出 `TOOL_NAME_EMPTY`（并记录与 `tool.loop.empty_tool_name` 相同的 warn 日志），通过在 `appendAssistantToolUseMessage` 之前运行来保持 tool_use/tool_result 配对不变量。
3. 连续空名计数器在任何正常执行 tool call 的轮次上重置，与 `consecutiveToolCallLimitRetries` 完全一致。

## 动机（Why）

空 tool-name 是模型输出质量缺陷，不是 capability 或授权失败。中断整个 run 会浪费用户的轮次，也不会给模型任何反馈。带纠正的恢复与已被验证的超限模式一致，让模型在下一轮自我纠正，同时 3 次尝试的兜底防止无限循环。

## 影响范围（Impact）

- `agent-core`：`tool-loop.ts`（新增 exports + guard）、`default-agent.ts`（恢复块 + 计数器）。
- `ts-minimal-agent-kernel` spec：新增 Requirement + Scenario。
- 不新增 Web API、gateway contract、persistence owner 或 capability contract。
- 新增可观测性事件名 `tool.loop.empty_tool_name` 和 `tool.loop.empty_tool_name_recoverable`，以及新的 `DEGRADATION_NOTICE` / safe-error code `TOOL_NAME_EMPTY`，均在本 change 中定义。
