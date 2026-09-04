## ADDED Requirements

### Requirement: Question pending input 支持文本、单选、多选和自定义答案

NextAgent SHALL 支持 `PendingInputKind.QUESTION`，用于在既有 request run 期间向用户澄清问题。Question pending input MUST 复用 runtime 持有的 pending 生命周期，并 MUST NOT 创建独立的 question 状态机。

#### Scenario: 文本 question 答案
- **WHEN** 一个 `QUESTION` pending input 包含一个没有选项的问题
- **THEN** 该问题的答案 MUST 恰好包含一个非空字符串
- **AND** runtime MUST 将该字符串视为用户对原始 run 继续执行的文本答案。

#### Scenario: 单选答案
- **WHEN** 一个 `QUESTION` pending input 包含一个带选项的问题且 `multiple` 缺失或为 false
- **THEN** 该问题的答案 MUST 恰好包含一个字符串
- **AND** 除非 `custom=true`，该字符串 MUST 匹配 pending 请求中的一个 option value
- **AND** 当 `custom` 缺失或为 false 时，任何非 option 值 MUST 以安全校验 outcome 被拒绝。

#### Scenario: 多选答案
- **WHEN** 一个 `QUESTION` pending input 包含一个带选项的问题且 `multiple=true`
- **THEN** 该问题的答案 MUST 包含一个或多个唯一且非空的字符串
- **AND** 除非 `custom=true`，每个被选中的字符串 MUST 匹配 pending 请求中的一个 option value
- **AND** runtime MUST 将有序的答案数组视为原始 run 继续执行的所选值。

#### Scenario: 自定义选项答案
- **WHEN** 一个 `QUESTION` pending input 包含一个带选项的问题且 `custom=true`
- **THEN** runtime MUST 对该问题既接受匹配的 option value，也接受至多一个非 option 的自定义文本值
- **AND** `custom=true` MUST 来自已接受的 pending 请求，而不是来自 client 答案 payload。

#### Scenario: 非法 question 答案 shape 被拒绝
- **WHEN** 一个 `QUESTION` 答案 entry 违反其已接受的 question 约束
- **THEN** runtime MUST 以安全校验 outcome 拒绝该答案
- **AND** runtime MUST NOT 将该 pending input resolve 为 `RECEIVED`。

### Requirement: Question 答案恢复原始 run

NextAgent SHALL 将已接受的 question 答案从已保存的 checkpoint 路由回原始 run 的继续执行。

#### Scenario: 已接受的 question 答案继续执行
- **WHEN** runtime 为一个 `QUESTION` pending input 接受有效答案
- **THEN** runtime MUST 将该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 从 pending checkpoint 恢复原始 run
- **AND** runtime MUST 使该答案对 run 继续执行可用，而不创建新的根 request。

#### Scenario: Question 超时不合成答案
- **WHEN** 一个 `QUESTION` pending input 超时
- **THEN** runtime MUST 将该 pending input resolve 为 `TIMED_OUT`
- **AND** runtime MUST NOT 合成文本答案或选项选择
- **AND** runtime MUST 以 pending-input 超时 outcome 将原始 run terminalize
- **AND** 可见 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`。

### Requirement: Question pending input 保持安全投影

NextAgent SHALL 仅向用户和下游投影暴露安全的 question 请求字段。

#### Scenario: Question 请求投影
- **WHEN** channel 为一个 `QUESTION` 投影 `USER_INPUT_REQUIRED`
- **THEN** payload MUST 只包含 pending input id、session id、kind、questions 和 timeoutAt
- **AND** question prompt、options、`multiple` 和 `custom` MUST 是已被接受的安全请求字段
- **AND** 投影 MUST NOT 包含隐藏 reasoning、model 原始输出、identity、幂等 key、origin 或 answer schema。
