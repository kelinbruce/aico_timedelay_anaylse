## MODIFIED Requirements

### Requirement: Api Header Params 的扩展键白名单

Skill manifest parser SHALL 将 `api_header_params` 扩展键加入白名单，允许它绕过 `unsafeKeyPattern` 检查（该检查原本会拒绝包含 `header` 的键）。该白名单是统一键安全策略的一个受控例外。它只适用于确切键名 `api_header_params`，不影响其他键。

#### Scenario: api_header_params 键被接受

- **WHEN** 某 skill manifest 提供了带安全字符串值的 `metadata.extension.api_header_params`
- **THEN** parser MUST 接受该键而不产生 `EXTENSION_OMITTED` 诊断
- **AND** 该值 MUST 被保留在 `SkillMetadata.extension` 中

#### Scenario: 其他包含 header 的键仍被拒绝

- **WHEN** 某 skill manifest 提供了 `metadata.extension.authorization_header` 或类似的包含 header 的键
- **THEN** parser MUST 仍然应用 `unsafeKeyPattern` 并拒绝或省略该键
- **AND** 白名单 MUST NOT 适用于 `api_header_params` 之外的键

### Requirement: 受治理行为可以消费特定扩展键

编排层（`agent-core` 路由）MAY 通过 `readSkillMetadata(descriptor).extension` 读取 `extension._naie_agentic_loop_flag` 来控制执行路径。这是"受治理行为不消费 extension"原则的一个受控例外。该例外只适用于 `_naie_agentic_loop_flag`。`_naie_pass_through_flag` 是一个保留字段，不被受治理行为消费（见 D7）。`api_header_params` 和 `api_request_params` MUST NOT 被受治理行为直接消费；它们 MUST 由 Skill 工具从 extension 读取并在 tool 结果中传递，供编排层和 API tool 消费。

#### Scenario: 编排层读取 agentic loop flag

- **WHEN** 编排层需要为某个 skill 确定执行路径
- **THEN** 它 MAY 读取 `readSkillMetadata(descriptor).extension._naie_agentic_loop_flag`
- **AND** 如果值为 `"false"`，它 MUST 触发非 agentic API 调用路径

#### Scenario: api_header_params 不被受治理行为消费

- **WHEN** 编排层处理某个 skill
- **THEN** 它 MUST NOT 直接读取 `extension.api_header_params`
- **AND** `api_header_params` MUST 由 Skill 工具从 extension 读取并在 tool 结果中传递（不被受治理行为或 API tool 直接从 extension 读取）
