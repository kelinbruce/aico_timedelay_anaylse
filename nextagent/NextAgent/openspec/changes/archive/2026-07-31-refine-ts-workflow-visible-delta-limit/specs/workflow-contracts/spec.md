## MODIFIED Requirements

### Requirement: WorkflowExecutionEvent

TS backend MUST 在 `agent-contracts/core` 中定义 `WorkflowExecutionEvent`，用于 node 生命周期观测。

#### Scenario: 安全的事件形状
- **WHEN** engine 发出 `WorkflowExecutionEvent`
- **THEN** event MUST NOT 包含 prompt、原始模型输出、原始 capability 结果、secret 或路径

#### Scenario: 安全的可见 delta
- **WHEN** node 需要向用户投影安全的中间可见内容
- **THEN** `WorkflowExecutionEvent` MAY 携带受控的 `visibleDelta`
- **AND** `visibleDelta` MUST 只允许 `CONTENT`、`THINKING`、`CHART`、`TABLE` 或 `DSL` channel 类型
- **AND** `visibleDelta.content` MUST 是安全的文本 delta
- **AND** `visibleDelta.content` 长度 MUST NOT 超过 150000 个字符
- **AND** contract MUST NOT 引入 workflow 对 runtime `LLM_CONTENT_DELTA` / `LLM_THINKING_DELTA` 的直接依赖
