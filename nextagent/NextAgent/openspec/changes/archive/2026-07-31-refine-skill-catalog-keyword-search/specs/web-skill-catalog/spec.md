## MODIFIED Requirements

### Requirement: Skill 列表查询关键字搜索

API SHALL 支持可选的 case-insensitive 关键字模糊搜索。当 `keyword` 参数提供时，API MUST 过滤结果为 `displayName`、`capabilityId` 或已投影 `sourceMetadata` 中本地化显示名（`zh-name`、`en-name`）包含该关键字子串（忽略大小写）的 Skill。`sourceMetadata` 中非 `zh-name`/`en-name` 的键、非字符串值以及缺失的 `sourceMetadata` MUST NOT 影响匹配结果。API MUST NOT 搜索 `description`、`inputSchema`、`outputSchema`、`extension`、运行治理 metadata、provider 配置或其他非可见字段。关键字搜索 MUST NOT 绕过 scope、availability 或 governance 检查。`keyword` 为空字符串或仅空白时 MUST 等同于不提供 `keyword`。

#### Scenario: 关键字匹配 displayName
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=alarm`
- **AND** 存在 `displayName` 包含 "alarm"（忽略大小写）的 Skill
- **THEN** 结果 MUST 包含该 Skill
- **AND** 结果 MUST NOT 包含 `displayName`、`capabilityId` 和 `sourceMetadata` 本地化显示名均不包含 "alarm" 的 Skill

#### Scenario: 关键字匹配 capabilityId
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=diag`
- **AND** 存在 `capabilityId` 包含 "diag"（忽略大小写）的 Skill
- **THEN** 结果 MUST 包含该 Skill

#### Scenario: 关键字匹配 sourceMetadata 本地化显示名
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=电信`
- **AND** 存在 Skill 的 `sourceMetadata.zh-name` 包含 "电信"
- **AND** 该 Skill 的 `displayName` 和 `capabilityId` 均不包含 "电信"
- **THEN** 结果 MUST 包含该 Skill
- **AND** 仅 `sourceMetadata.en-name` 不包含该关键字时，该 Skill 仍可由 `zh-name` 命中

#### Scenario: sourceMetadata 缺失时仅匹配 displayName 和 capabilityId
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=alarm`
- **AND** 存在 Skill 没有 `sourceMetadata` 或 `sourceMetadata` 中没有字符串 `zh-name`/`en-name`
- **THEN** 该 Skill MUST 仅由 `displayName` 或 `capabilityId` 决定是否命中

#### Scenario: 关键字不匹配 description 或非可见 metadata
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=internal`
- **AND** 存在 Skill 的 `description`、`extension` 或运行治理 metadata 包含 "internal"
- **AND** 该 Skill 的 `displayName`、`capabilityId` 和 `sourceMetadata.zh-name`/`en-name` 均不包含 "internal"
- **THEN** 结果 MUST NOT 包含该 Skill

#### Scenario: 关键字无匹配
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=zzzzz`
- **AND** 没有任何 Skill 的 `displayName`、`capabilityId` 或 `sourceMetadata` 本地化显示名包含 "zzzzz"
- **THEN** 系统 MUST 返回 `total=0`、`skills=[]` 的 200 响应

#### Scenario: 空关键字等同于无关键字
- **WHEN** 客户端发送 `GET /api/v1/skills?keyword=` 或 `keyword=%20`
- **THEN** 系统 MUST 返回与不带 `keyword` 参数时相同的结果集
