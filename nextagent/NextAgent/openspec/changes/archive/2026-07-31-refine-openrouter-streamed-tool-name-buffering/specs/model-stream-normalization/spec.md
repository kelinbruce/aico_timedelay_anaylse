## ADDED Requirements

### Requirement: 流式工具名称与参数完整聚合

当 provider 把同一个 ToolCall 的工具名称或 arguments 拆分到多个流式 chunk 时，模型流归一化边界 SHALL 按稳定 tool-call 坐标保留分片顺序并独立聚合工具名称与 arguments。系统 MUST 仅在非空完整工具名称、稳定 tool-call id 和可解析为 JSON object 的完整 arguments 同时可用后，发出一个 `ModelStreamDelta.toolCall`；相同的标准化调用 MUST 出现在终态 `ModelFinalResult.toolCalls` 中。

归一化期间的 provider-native 分片 MUST NOT 进入 Agent Core、Web stream、timeline、history、日志或持久化。不同 tool-call 坐标的分片 MUST NOT 相互合并。

#### Scenario: 工具名称在首个分片后到达
- **WHEN** 同一 ToolCall 的首个 provider chunk 携带稳定调用坐标但工具名称为空，后续 chunk 携带非空工具名称与其余 arguments
- **THEN** 归一化边界 MUST 缓冲该调用，而不是发出空名称 ToolCall
- **AND** 工具名称与完整 arguments 可用后 MUST 只发出一个标准化 ToolCall

#### Scenario: 工具名称被拆成多个分片
- **WHEN** 同一 ToolCall 的工具名称按顺序拆成两个或更多非空片段，arguments 也可独立拆片
- **THEN** 归一化边界 MUST 按到达顺序分别拼接名称与 arguments
- **AND** 最终标准化工具名称 MUST 等于全部名称片段的有序拼接结果

#### Scenario: 多个并行工具调用交错返回
- **WHEN** 两个或更多 ToolCall 的名称与 arguments 分片按不同 tool-call 坐标交错到达
- **THEN** 归一化边界 MUST 分别聚合每个调用
- **AND** `ModelFinalResult.toolCalls` MUST 保持这些调用首次出现的顺序

#### Scenario: 流结束时工具调用仍不完整
- **WHEN** provider stream 结束时某个 ToolCall 仍没有非空工具名称，或其完整 arguments 不能解析为 JSON object
- **THEN** 模型调用 MUST 通过既有 safe model failure boundary 失败
- **AND** 系统 MUST NOT 向 Core 发出或执行该不完整 ToolCall
