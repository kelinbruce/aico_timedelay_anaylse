# skill-catalog-query Specification

## Purpose
定义受治理 Skill catalog 的查询结果、来源元数据和可见性约束，使调用方只能检索到当前执行范围内已经验证的 Skill 描述。
## Requirements
### Requirement: Skill catalog exposes validated source metadata
`GET /api/v1/skills` SHALL return an optional `sourceMetadata` field for each user-invocable Skill when its validated `SkillMetadata.sourceMetadata` is present. The returned value MUST contain only that source metadata and MUST NOT expose `SkillMetadata.extension`, model configuration, tool constraints, or the complete internal metadata object.

#### Scenario: Catalog entry has source metadata
- **WHEN** a user-invocable Skill has validated `sourceMetadata` containing `zh-name` and `en-name`
- **THEN** the corresponding catalog entry MUST return those values in `sourceMetadata`
- **AND** the existing capabilityId, displayName, description, providerKind, and version semantics MUST remain unchanged

#### Scenario: Catalog entry has no source metadata
- **WHEN** a user-invocable Skill has no validated source metadata
- **THEN** the corresponding catalog entry MUST omit `sourceMetadata`

#### Scenario: Skill has internal-only metadata
- **WHEN** a user-invocable Skill has extension, model, allowed-tools, or denied-tools metadata
- **THEN** the catalog entry MUST NOT return those values through `sourceMetadata`

### Requirement: Skill catalog uses localized display-name fallback
The Skill catalog page and selected Skill display SHALL use `sourceMetadata.zh-name` when the active UI language is Chinese and `sourceMetadata.en-name` when the active UI language is non-Chinese. When the selected value is missing or not a string, the UI MUST display the existing `displayName`.

#### Scenario: Chinese UI displays configured Chinese name
- **WHEN** the active UI language is Chinese and a catalog entry has a string `sourceMetadata.zh-name`
- **THEN** the catalog entry and selected Skill display MUST show that Chinese name

#### Scenario: Non-Chinese UI displays configured English name
- **WHEN** the active UI language is non-Chinese and a catalog entry has a string `sourceMetadata.en-name`
- **THEN** the catalog entry and selected Skill display MUST show that English name

#### Scenario: Localized name is unavailable
- **WHEN** the language-specific source metadata value is absent or is not a string
- **THEN** the catalog entry and selected Skill display MUST show `displayName`
