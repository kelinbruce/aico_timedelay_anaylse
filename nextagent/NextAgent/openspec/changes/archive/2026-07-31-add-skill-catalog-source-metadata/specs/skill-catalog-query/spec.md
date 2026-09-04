## ADDED Requirements

### Requirement: Skill catalog 暴露已校验的 source metadata
`GET /api/v1/skills` SHALL 在每个用户可调用 Skill 的已校验 `SkillMetadata.sourceMetadata` 存在时，为其返回可选的 `sourceMetadata` 字段。返回值 MUST 只包含该 source metadata，MUST NOT 暴露 `SkillMetadata.extension`、模型配置、tool 约束或完整的内部 metadata 对象。

#### Scenario: Catalog 条目带有 source metadata
- **WHEN** 一个用户可调用 Skill 的已校验 `sourceMetadata` 包含 `zh-name` 和 `en-name`
- **THEN** 对应 catalog 条目 MUST 在 `sourceMetadata` 中返回这些值
- **AND** 既有的 capabilityId、displayName、description、providerKind 和 version 语义 MUST 保持不变

#### Scenario: Catalog 条目没有 source metadata
- **WHEN** 一个用户可调用 Skill 没有已校验的 source metadata
- **THEN** 对应 catalog 条目 MUST 省略 `sourceMetadata`

#### Scenario: Skill 具有仅内部使用的 metadata
- **WHEN** 一个用户可调用 Skill 带有 extension、model、allowed-tools 或 denied-tools metadata
- **THEN** catalog 条目 MUST NOT 通过 `sourceMetadata` 返回这些值

### Requirement: Skill catalog 使用本地化 displayName 回退
Skill catalog 页面和所选 Skill 展示 SHALL 在当前 UI 语言为中文时使用 `sourceMetadata.zh-name`，在当前 UI 语言为非中文时使用 `sourceMetadata.en-name`。当所选值缺失或不是字符串时，UI MUST 显示既有 `displayName`。

#### Scenario: 中文 UI 显示配置的中文名
- **WHEN** 当前 UI 语言为中文且一个 catalog 条目具有字符串 `sourceMetadata.zh-name`
- **THEN** 该 catalog 条目和所选 Skill 展示 MUST 显示该中文名

#### Scenario: 非中文 UI 显示配置的英文名
- **WHEN** 当前 UI 语言为非中文且一个 catalog 条目具有字符串 `sourceMetadata.en-name`
- **THEN** 该 catalog 条目和所选 Skill 展示 MUST 显示该英文名

#### Scenario: 本地化名称不可用
- **WHEN** 语言专属的 source metadata 值缺失或不是字符串
- **THEN** 该 catalog 条目和所选 Skill 展示 MUST 显示 `displayName`
