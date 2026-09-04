## MODIFIED Requirements

### Requirement: WorkflowExecutionEvent

TS 后端 MUST 在 `agent-contracts/core` 中定义 `WorkflowExecutionEvent`，用于节点生命周期观测。`WorkflowExecutionEvent` MUST 新增可选 `input` 字段，携带 safe resolved inputs（变量引用已解析、secret 明文已 redact）。engine MUST 在 handler 调用前统一 resolveNodeValue + resolveSecrets + redactSecretsFromValue，把 safe resolved inputs 放入 NODE_STARTED event 的 input 字段。

- input 字段类型为 optional JsonObject
- input MUST NOT 包含 secret 明文（通过 redactSecretsFromValue 替换为 [REDACTED]）
- input MUST 记录变量引用解析后的实际值（不是原始配置中的占位符）
- input 仅在 NODE_STARTED 事件中携带，NODE_COMPLETED/NODE_FAILED 事件不携带 input（output 在这些事件中携带）
- engine 层 resolve 仅用于 event 携带 input，不传入 handler（handler 仍各自 resolve）

#### Scenario: Safe Event Shape

- **WHEN** engine 发出 `WorkflowExecutionEvent`
- **THEN** event MUST NOT 包含 prompt、raw model output、raw capability result、secret 或 path
- **AND** event.input MUST NOT 包含 secret 明文（通过 redactSecretsFromValue 替换为 [REDACTED]）

#### Scenario: Safe Visible Delta

- **WHEN** 节点需要向用户投影安全的中间可见内容
- **THEN** `WorkflowExecutionEvent` MAY 承载受控的 `visibleDelta`
- **AND** `visibleDelta` MUST 只允许 `CONTENT` 或 `THINKING` 两类 channel
- **AND** `visibleDelta.content` MUST 是安全文本增量
- **AND** contract MUST NOT 引入 workflow 对 runtime `LLM_CONTENT_DELTA` / `LLM_THINKING_DELTA` 的直接依赖

#### Scenario: NODE_STARTED Carries Safe Resolved Input

- **GIVEN** restful 节点配置 inputs 含 api_name 和引用上游变量的 device_id_list
- **WHEN** 节点执行发出 NODE_STARTED event
- **THEN** event.input MUST 含 api_name 的实际值和 device_id_list 解析后的实际值
- **AND** event.input MUST NOT 含 secret 明文

#### Scenario: NODE_COMPLETED Does Not Carry Input

- **GIVEN** 节点执行完成发出 NODE_COMPLETED event
- **THEN** event MUST NOT 含 input 字段
- **AND** event MUST 含 output 字段