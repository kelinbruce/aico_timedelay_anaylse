## MODIFIED Requirements

### Requirement: Timeout and Retry

engine MUST 支持节点级 timeout 和 retry。对等待型节点（`user-check` 的 `QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 场景），`node.timeout` 同时表达等待超时语义：handler 读取 `context.node.timeout` 转换为 `timeoutAt` 交给 runtime pending input 层管理，engine 的 abort signal 在 handler 返回后立即 dispose，不约束 WAITING 期间。等待超时上限 MUST 为 48h（172800 秒），最小为 1s。超时 MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 exception 分支处理，无 exception 则 `terminalState: FAILED`。

#### Scenario: Retry Exhausted
- **WHEN** 节点重试耗尽
- **THEN** engine MUST 产出失败或跳过结果

#### Scenario: Wait Timeout Reuses Node Timeout
- **WHEN** 等待型节点配置 `node.timeout` 并进入 WAITING 状态
- **THEN** handler MUST 读取 `context.node.timeout` 转换为 `timeoutAt`
- **AND** engine abort signal MUST 在 handler 返回后 dispose
- **AND** WAITING 期间超时 MUST 由 runtime pending input 的 `timeoutAt` 管理

#### Scenario: Wait Timeout Upper Bound 48h
- **WHEN** 等待型节点配置 `node.timeout` 超过 48h（172800 秒）
- **THEN** runtime MUST 拒绝该 `timeoutAt` 并抛 `PENDING_INPUT_INTENT_INVALID`

#### Scenario: Wait Timeout Failure Routes Via Exception
- **WHEN** 等待型节点超时
- **THEN** engine MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** exception condition MUST 能通过 `error.category == "TIMEOUT"` 匹配
- **AND** 无 exception 分支时 MUST 以 `terminalState: FAILED` 中断
