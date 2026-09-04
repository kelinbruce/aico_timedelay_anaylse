# memory-extraction Delta

## MODIFIED Requirements

### Requirement: 提取 candidate 质量契约

系统 SHALL 把提取输出表示为 memory extraction candidate。每个 candidate 在写入长期记忆前 MUST 通过结构、质量、去重和安全校验。

按 category 划分的内容：

- `FACTUAL` candidate 使用 `subject` 和 `claim`。
- `CONCEPTUAL` candidate 使用 `concept` 和 `definition`。
- `PROCEDURAL` candidate 使用 `procedureName` 和非空 `procedureText`。
- `USER_CHARACTERISTICS` candidate 使用非空 `traits[]` 和非空 `purpose[]`。

`PROCEDURAL` 提取 MAY 从已验证的可复用动作摘要构建 `procedureText`，但保留的记忆 candidate MUST NOT 要求结构化 `steps[]`。

#### Scenario: Procedural candidate 使用文本正文

- **WHEN** 提取从已验证的 task trajectory 构建出有效可复用的 `PROCEDURAL` candidate
- **THEN** candidate 内容 MUST 包含 `procedureName` 和 `procedureText`
- **AND** gateway 写入 MUST not 为该 procedural memory 要求或持久化 `steps[]`。
