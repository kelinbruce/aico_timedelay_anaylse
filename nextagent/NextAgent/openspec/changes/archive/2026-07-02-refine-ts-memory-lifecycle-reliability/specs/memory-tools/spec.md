## ADDED Requirements

### Requirement: FACTUAL 便捷输入只在 memory tool 边界归一化

`add_memory` SHALL 接受 `FACTUAL` 内容的非空字符串，SHALL 接受恰好以 `claim`、`fact`、`text` 或 `value` 之一作为 claim 来源的结构化 FACTUAL tool input。在调用 memory core gateway 之前，tool MUST 把该输入归一化为 `{ category: "FACTUAL", subject, claim, evidence?, qualifiers? }`。别名字段和任何模型提供的额外字段 MUST NOT 进入 `SaveLongTermMemoryRequest`、持久化内容、日志、metric 或诊断。该便捷行为 MUST 保持由面向模型的 memory tool 边界拥有，MUST NOT 放宽 memory core gateway contract 或 common capability executor。

#### Scenario: FACTUAL 字符串在 gateway 写入前被归一化
- **WHEN** 模型调用 `add_memory(category="FACTUAL", content="SLA threshold is 99.99%")`
- **THEN** tool MUST 写入 `subject` 和 `claim` 均为输入文本的 FACTUAL 内容
- **AND** core gateway MUST NOT 收到任何 tool 专属别名

#### Scenario: FACTUAL claim 别名不被持久化
- **WHEN** 模型调用 `add_memory` 时 FACTUAL 内容包含 `fact="BGP peer is 10.0.0.1"`
- **THEN** tool MUST 把 `fact` 映射为 canonical `claim`
- **AND** 持久化内容 MUST NOT 包含 `fact`、`text`、`value` 或无关额外字段
