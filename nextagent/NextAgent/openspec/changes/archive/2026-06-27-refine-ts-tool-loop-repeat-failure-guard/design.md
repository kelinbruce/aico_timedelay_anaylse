# Design

## Decision

实现位置选在 `agent-core/src/tools/tool-loop.ts`。这是最小代价位置，因为 tool loop 已经能同时看到：

- 当前 `run`
- model tool call 的 capability id 和 arguments
- capability result status
- safeError code/category/retryable
- 是否属于可继续的非终止型失败

## Failure Fingerprint

request-local fingerprint 由以下字段组成：

- `capabilityId`
- normalized JSON arguments
- structured failure output
- result status
- safeError code
- safeError category

`toolCallId` 不进入 fingerprint，因为重复调用通常会生成新的 tool call id。

参数归一只保证 JSON object key 顺序稳定，不做工具命令语义归一。例如 Bash 参数中等价但空白不同的命令字符串会形成不同 fingerprint；本 change 只阻断同一 run 内字面输入和结构化失败输出均相同的重复失败。

## Guard Timing

首次失败保持现有行为：写入 `CAPABILITY_RESULT`，允许下一轮模型修正。

第一次、第二次相同失败：

1. 保持现有行为，仍写入当前 capability result。
2. 保持现有能力完成/降级事件，不触发重复失败终止。

第三次相同失败：

1. 仍写入当前 capability result。
2. 仍发出 capability completed / degradation notice。
3. 额外发出 `DEGRADATION_NOTICE { code: "CAPABILITY_REPEATED_FAILURE" }`。
4. 抛出 `AgentError("CAPABILITY_REPEATED_FAILURE")` 终止 run。

## Non-goals

- 不新增持久化状态。
- 不跨 request/run 记忆失败。
- 不改变终止型失败类别现有行为。
- 不为每个工具定义专属 retry policy。
