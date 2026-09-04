## MODIFIED Requirements

### Requirement: Bash 工具输入与 TonyClaw 兼容

公开的 `bash` 工具输入 SHALL 使用稳定的规范字段 `command`、可选 `description` 和可选 `timeout`。兼容别名 `timeout_ms` 也可被接受用于模型产生的 tool 输入，但它 SHALL NOT 取代 `timeout` 作为规范字段名。

当两个字段同时存在时，`timeout` SHALL 保持权威。`timeout_ms` 兼容性 SHALL 只接受与规范 `timeout` 相同的正整数形状。规范化后，有效的 timeout 语义保持不变：默认 `120000` ms，上限 `600000` ms，并进一步受可信调用 timeout 约束。

首个 TS 发布 SHALL NOT 接受后台执行控制。

#### Scenario: 兼容别名 timeout_ms 被接受

- **WHEN** 模型提供 `timeout_ms` 而非 `timeout`
- **THEN** Bash 输入规范化 MUST 将其作为 timeout 别名接受
- **AND** 有效 timeout MUST 遵循既有 Bash timeout 边界

#### Scenario: 规范 timeout 优先于兼容别名

- **WHEN** 同时提供 `timeout` 和 `timeout_ms`
- **THEN** Bash MUST 使用 `timeout`
- **AND** 该别名 MUST NOT 覆盖规范字段
