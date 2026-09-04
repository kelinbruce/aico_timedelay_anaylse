## MODIFIED Requirements

### Requirement: Skill Tool 非 agentic 分发

`Skill` 工具 SHALL 在 `readSkillMetadata` 之后、既有的 fork context 检查之前检查 `extension._naie_agentic_loop_flag`。当该 flag 为 `"false"` 时，`Skill` 工具 MUST 仍然通过 `loadCanonicalBodyView` 加载 skill body 以解析 api 命令，但 MUST NOT 继续执行资源投影或 body 注入。它 MUST 返回一个 `CapabilityInvocationResult`，包含 skill 身份、解析出的 api 命令信息以及 metadata 中的 `nonAgenticApiCall: true` 信号。当该 flag 为 `"true"` 或缺失时，既有执行路径 MUST 保持完全不变。

#### Scenario: Flag 为 false 时返回非 agentic 结果而不注入 body

- **WHEN** 模型以有效的 skill 名调用 `Skill`
- **AND** `readSkillMetadata` 返回的 metadata 中 `extension._naie_agentic_loop_flag` 等于 `"false"`
- **THEN** `Skill` 工具 MUST 调用 `loadCanonicalBodyView` 加载 body 用于 api 命令解析
- **AND** MUST NOT 调用 `projectSkillResources`
- **AND** MUST 返回 `status=SUCCEEDED` 的 `CapabilityInvocationResult`
- **AND** `structuredPayload` MUST 包含解析出的 skill 名和来自 skill body 的已解析 api 命令
- **AND** `metadata` MUST 包含 `nonAgenticApiCall: true`
- **AND** `generatedMessages` MUST 为空

#### Scenario: Flag 为 true 或缺失时遵循既有路径

- **WHEN** 模型以有效的 skill 名调用 `Skill`
- **AND** `extension._naie_agentic_loop_flag` 为 `"true"` 或 extension 字段缺失
- **THEN** `Skill` 工具 MUST 继续执行既有的 inline body 加载与注入路径
- **AND** 行为 MUST 与当前实现完全一致
