## MODIFIED Requirements

### Requirement: Hook And Pending Boundary Baseline

lifecycle hook boundary、pending input lifecycle 和 producer boundary MUST 由 runtime 拥有。pending input MUST 通过 frozen producer boundary 进入 runtime-owned contract。pending input 持久化对象和客户端 request MUST 保持精简。`PendingInputQuestion` 和 `PendingInputQuestionRecord` MUST 支持可选 `inputFormat` 字段，用于携带填空题格式约束。

#### Scenario: Pending input 由 runtime 拥有
- **WHEN** a lifecycle hook or a later explicitly defined upstream producer requests user input, confirmation, authorization or human handoff
- **THEN** the request MUST enter the runtime-owned pending input contract through a frozen producer boundary
- **AND** channel 只负责展示和提交 answer
- **AND** model output, client payload and capability-private state MUST NOT create or own pending lifecycle
- **AND** standalone policy logic, runtime-internal steps or capability governance MUST NOT become independent pending producers without a separate contract change
- **AND** a visible or durable partial pending input lifecycle MUST NOT be created unless the owning lifecycle also guarantees checkpoint-before-visible, same-session lane protection, and defined answer, cancel and timeout recovery paths

#### Scenario: Pending input 边界对象保持精简
- **WHEN** runtime 创建 pending input
- **THEN** 持久化对象 MUST 只保存 pendingInputId、requestRunId、sessionId、requestId、requestContextId、checkpointId、kind、questions、timeoutAt、status、createdAt、updatedAt、responseAnswers 和 runtime-owned `producerRef`
- **AND** `producerRef` MUST be derived from trusted runtime/core execution context and MUST NOT be supplied by model output, client payload, channel metadata, capability args, gateway records or tool input
- **AND** question 对象 MUST support optional `multiple`，仅表示该 question 的 answer entry 是否允许多个值，缺省 MUST 等价于 `false`
- **AND** question 对象 MUST support optional `custom`，仅表示该 question 是否允许非选项值文本，缺省 MUST 等价于 `false`
- **AND** question 对象 MUST support optional `inputFormat`，携带填空题格式约束；`inputFormat` 为可选 opaque JSON 对象，缺省时 MUST 等价于无格式约束；`inputFormat` 的子字段不做约束，产品按需定义
- **AND** `inputFormat` MUST NOT 携带 credential、路径或高基数字段
- **AND** runtime MUST 透传但不解释 `inputFormat` 内容
- **AND** 发给客户端的 request MUST 只包含 id、sessionId、kind、questions 和 timeoutAt
- **AND** 客户端提交的 answer MUST 只包含 sessionId、pendingInputId 和按问题顺序排列的 answers
- **AND** answers MUST 使用 string 二维数组表达，外层数组与 questions 顺序一致
- **AND** 文本题 answer entry MUST contain exactly one non-empty string
- **AND** 单选题 answer entry MUST contain exactly one string matching an allowed option unless `custom=true`
- **AND** 多选题 answer entry MAY contain multiple unique strings when the accepted question has `multiple=true`
- **AND** option question with `custom=true` MAY include at most one non-option custom text value
- **AND** single-select question with `custom=true` MUST contain exactly one total value, either one allowed option or one non-option custom text value
- **AND** multi-select question with `custom=true` MAY contain multiple unique allowed options and at most one non-option custom text value
- **AND** identity、idempotency key、audit linkage、timeout behavior、origin、run version、step id、answer schema 和 model-formatted answer MUST NOT 出现在 pending input 客户端 answer 或核心持久化对象中
- **AND** `inputFormat` MUST NOT 出现在客户端 answer payload 中

#### Scenario: Pending input answer enters runtime through command boundary
- **WHEN** a client submits a pending input answer
- **THEN** the answer MUST enter runtime only through `RuntimeCommandPort.answerPendingInput(command)` with trusted identity and idempotency injected by channel/auth boundary
- **AND** the Web answer payload MUST accept only `sessionId`、`pendingInputId` and ordered `answers`
- **AND** channel MUST call only `RuntimeCommandPort.answerPendingInput`

#### Scenario: Pending input idempotent resolve
- **WHEN** the same owner+agent+session+pendingInput receives the same answer command idempotency key and semantic again
- **THEN** runtime MUST return the equivalent resolved `PendingInputRecord`
- **AND** runtime MUST NOT execute the answer side effect again

#### Scenario: Pending input timeout handled by runtime
- **WHEN** a pending input's `timeoutAt` has elapsed
- **THEN** runtime MUST resolve the pending input as `TIMED_OUT`
- **AND** runtime MUST commit a terminal outcome for the owning run
- **AND** the terminal outcome MUST be `FAILED` when the pending input timeout represents an unresolved wait
- **AND** runtime MUST NOT persist timeout behavior as a field on `PendingInput`、`PendingInputRequest`、`PendingInputAnswer` or gateway record

#### Scenario: Pending input timeout upper bound 48h
- **WHEN** pending input 的 `timeoutAt` 超过当前时间 48h（172800 秒）
- **THEN** runtime MUST 拒绝该 pending input 并抛 `PENDING_INPUT_INTENT_INVALID`
- **AND** runtime MUST NOT 接受超过 48h 的 `timeoutAt`

#### Scenario: InputFormat is opaque typed passthrough
- **WHEN** pending input question 携带 `inputFormat` 字段
- **THEN** runtime MUST 透传 `inputFormat` 到持久化对象和客户端 request
- **AND** runtime MUST NOT 校验或解析 `inputFormat` 内容
- **AND** `inputFormat` MUST NOT 出现在客户端 answer payload 中
- **AND** askUserQuestion 不设 `inputFormat` 时行为 MUST 不变
