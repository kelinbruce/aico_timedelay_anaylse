## ADDED Requirements

### Requirement: Tool-call 轮次为后续 model invocation 保留公开 assistant 内容

当一个 model 结果同时包含公开 assistant 内容和一个或多个 tool calls 时，Agent Core SHALL 在 capability 调用之前，将非空公开内容和有序 tool calls 持久化到同一条隐藏 assistant tool-use 会话消息中。该消息 SHALL 保留既有 owner scope、Agent scope、request/run 坐标、可见性、active-context 复合写入和 tool-call 幂等语义。

Agent Core SHALL NOT 将模型 reasoning/thinking、raw provider 响应或 timeline/stream replay 持久化为 assistant 内容。持久化失败 SHALL 通过既有的显式 request 失败路径失败，MUST NOT 在丢弃公开内容后静默执行 tool 批次。

持久化的公开内容 SHALL 只属于产生该 assistant tool-use 消息中 tool calls 的那次 model invocation。Agent Core SHALL NOT 前置或追加来自更早或更晚 tool 轮次的公开内容，即使 request 级 stream 投影保留了累积的可见内容。

#### Scenario: 公开内容与 tool calls 存续到下一个 model 轮次

- **GIVEN** 一次 model invocation 返回非空公开 assistant 内容和有序 tool calls
- **WHEN** Agent Core 接受该 tool 批次执行
- **THEN** Agent Core MUST 持久化一条包含该公开内容和这些 tool calls 的隐藏 `ASSISTANT_TOOL_USE` 消息
- **AND** 匹配的 capability results MUST 保留既有 toolCallId 和 toolName 配对
- **AND** 后续 model invocation MUST 在一条 assistant 消息中收到公开内容和 tool calls，后跟匹配的 tool results

#### Scenario: 仅含 tool call 的响应保持支持

- **GIVEN** 一次 model invocation 返回 tool calls 且公开内容为空
- **WHEN** Agent Core 接受该 tool 批次执行
- **THEN** 隐藏 assistant tool-use 消息 MUST 保持为一条有效的仅 tool-call 消息
- **AND** 后续 model invocation MUST 收到 tool calls 和匹配的 tool results 且不带空文本 part

#### Scenario: 连续 tool 轮次保持彼此独立

- **GIVEN** 一个 request 包含两次连续 model invocation，各自返回不同的公开内容和 tool calls
- **WHEN** Agent Core 持久化两个已接受的 tool 批次并组装下一个 model 请求
- **THEN** 每条隐藏 assistant tool-use 消息 MUST 只包含来自其自身 model invocation 的公开内容
- **AND** 下一个 model 请求 MUST 包含两条不同的 assistant 消息，且不在第二条消息中重复第一轮的公开内容

#### Scenario: 公开内容持久化显式失败

- **GIVEN** 一次 model invocation 返回公开 assistant 内容和 tool calls
- **WHEN** 复合 assistant tool-use 消息写入失败
- **THEN** Agent Core MUST NOT 只凭该内容的 live stream 副本继续执行 tool 批次
- **AND** 该 request MUST 遵循既有安全失败路径

#### Scenario: reasoning 不作为 assistant 内容保留

- **GIVEN** 一次 model invocation 返回公开内容、reasoning 和 tool calls
- **WHEN** Agent Core 持久化并在之后渲染该 assistant tool-use 消息
- **THEN** 只有公开内容和 tool calls MUST 进入该消息和后续 model 请求
- **AND** reasoning MUST NOT 进入持久化的会话消息或后续 model 请求
