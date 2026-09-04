## ADDED Requirements

### Requirement: Context Engine 在渲染前拥有预算可解释性

Context Engine SHALL 在模型输入渲染之前完成预算可解释性。它 SHALL 基于选定的模型窗口、预留输出预算、最小安全的当前请求 context、先前历史候选以及 Query Policy compaction 计划得出结果，并 SHALL 产生可检视的 selection 与 compaction 原因。

选定的模型窗口 SHALL 在装配期间从已受理 Agent 配置的 model profile 派生，预留输出预算从生效的 model options 派生。两者都 SHALL NOT 由 `ContextAssemblyRequest` 携带。

预算可解释性 SHALL 为装配期间考虑的每个 context source 类别包含 source 级证据：选定的 active history、当前请求、attachment 投影、capability 披露、runtime context、project instruction context、summary 或 session-memory 替换，以及启用时的后续 memory 检索披露。每个证据条目 SHALL 包含安全的 source 类别、估算的 input units、selected/omitted/degraded 状态、reason code 和 owning boundary。它 SHALL NOT 包含 raw prompt 文本、raw message 内容、raw tool 结果、raw attachment 内容、本地路径、credential 或高基数字段。

#### Scenario: Context assembly 在渲染前计算预算证据
- **WHEN** Context Engine 为一个模型支撑的步骤装配 context
- **THEN** 它在渲染前完成可用输入预算计算、历史预算 handoff 和 compaction 可解释性
- **AND** 这些机器可读的 explainability 事实作为 Context Engine / Query Policy diagnostics 可用，供下游渲染、audit、structured log、observability metric 和 runtime 降级通知使用

#### Scenario: Source 级预算证据安全且完整
- **WHEN** Context Engine 从 history、runtime context、project instructions、capability 披露、attachments 或 memory 相关来源装配 context
- **THEN** 预算可解释性记录每个 source 类别的 selected/omitted/degraded 状态和安全 reason code
- **AND** 它记录 unit 估算和 owning boundary，而不暴露 raw source 内容

### Requirement: Context Engine 保护最小安全的当前请求 context

Context Engine SHALL 把根用户消息、当前请求协议必需的消息和最新请求必需的 attachment context 视为最小安全的当前请求 context。该基线 SHALL NOT 被放入 60% 的先前历史预算上限之内，也 SHALL NOT 为了给先前历史腾出空间而被静默丢弃。

历史 attachment context MAY 在先前历史预算内竞争，MAY 被降级，但这种降级 MUST 是显式且可解释的。一个无法被安全投影或预算的最新请求必需 attachment MUST 使当前装配失败，而不是静默地按纯文本继续。

#### Scenario: 最新请求的最小安全 context 受到保护
- **WHEN** Context Engine 识别出根用户消息、当前请求协议必需的消息和最新请求必需的 attachment context
- **THEN** 它把它们视为最小安全的当前请求 context
- **AND** 它不把它们计入 60% 的历史预算上限

#### Scenario: 最小安全 context 无法容纳
- **WHEN** 最小安全的当前请求 context 仍无法容纳在安全输入预算之内
- **THEN** Context Engine MUST 返回显式的 insufficient-context 失败或等价的安全降级 outcome
- **AND** 它 MUST NOT 通过移除请求关键内容来伪造成功装配

#### Scenario: 最新请求 attachment 不能被静默降级掉
- **WHEN** 一个最新请求必需的 attachment 变得不可用，或作为最小安全当前请求 context 的一部分无法容纳
- **THEN** 系统 MUST 以安全 error 或 insufficient-context outcome 显式失败
- **AND** 它 MUST NOT 静默地当作请求是纯文本一样继续

### Requirement: 输出窗口安全是显式的

每个模型支撑的步骤 MUST 实施输出窗口安全。当模型输出窗口上限阻止完成当前输出时，系统 MUST 通过显式的续步（continuation step）、降级/部分结果通知或失败处理告知用户。最终输出 MUST NOT 被静默截断。

#### Scenario: 输出窗口限制保持显式
- **WHEN** 输出窗口 guard 判定本轮需要 continuation、部分结果降级或失败
- **THEN** 系统 MUST 把结果表达为显式的 continuation、降级或失败语义
- **AND** 它 MUST NOT 把一个受长度限制的结果当作完整最终答案提交
