# web-skill-catalog Specification

## Purpose
定义 Web channel Skill 列表查询 API 的行为契约：端点、请求参数、响应 DTO、scope 校验、来源聚合和安全边界。
## Requirements
### Requirement: Skill 列表查询 API 端点

系统 SHALL 通过 Web channel 暴露只读 `GET /api/v1/skills` 端点，用于查询当前 Agent Scope 下可用的 SKILL capability 列表。该端点 MUST 接受 `pageNum`（整数，默认 1，最小 1）、`pageSize`（整数，默认 50，最小 1，最大 100）和可选 `keyword`（字符串）三个查询参数，MUST NOT 接受 request body。端点 MUST 返回包含 `total`、`pageNum`、`pageSize` 和 `skills` 数组的分页响应。端点 MUST NOT 修改 capability catalog 状态、Agent assembly 或任何持久化事实。

#### Scenario: 使用默认分页查询 Skill 列表
- **WHEN** 客户端发送 `GET /api/v1/skills` 不带任何查询参数
- **THEN** 系统返回 `pageNum=1`、`pageSize=50` 的第一页结果
- **AND** 响应 `total` 字段 MUST 反映当前 Agent Scope 下可用 Skill 的总数
- **AND** `skills` 数组 MUST 包含最多 50 个 skill summary 对象

#### Scenario: 使用自定义分页查询 Skill 列表
- **WHEN** 客户端发送 `GET /api/v1/skills?pageNum=2&pageSize=20`
- **THEN** 系统返回第二页、每页 20 条的结果
- **AND** `skills` 数组 MUST 包含第 21 到第 40 个 skill summary 对象
- **AND** `total` 字段 MUST 反映完整匹配集的大小

#### Scenario: 非法分页参数被拒绝
- **WHEN** 客户端发送 `GET /api/v1/skills?pageNum=0` 或 `pageSize=0` 或 `pageSize=200`
- **THEN** 系统 MUST 返回 400 状态码和 safe error
- **AND** 错误消息 MUST NOT 暴露内部实现细节

### Requirement: Skill 列表查询响应 DTO

响应 SHALL 使用固定 DTO shape，包含 `total`（非负整数）、`pageNum`（正整数）、`pageSize`（正整数）和 `skills`（数组）。每个 skill summary 对象 SHALL 包含 `capabilityId`（非空字符串）、`displayName`（非空字符串）、`description`（字符串）、`providerKind`（枚举值），MAY 包含 `version`（字符串）。响应 MUST NOT 包含 `inputSchema`、`outputSchema`、`compatibility`、`metadata`、provider 私有配置、credential reference、文件路径、catalog 内部 governance evidence 或 raw provider error。

#### Scenario: 正常响应包含 skill summary
- **WHEN** 查询返回一个或多个可用 Skill
- **THEN** 每个 skill summary MUST 包含 `capabilityId`、`displayName`、`description`、`providerKind`
- **AND** `providerKind` 的值 MUST 为 `BUNDLED`、`LOCAL_DIRECTORY` 或 `SKILL_HUB`
- **AND** 响应 MUST NOT 包含 `inputSchema`、`outputSchema`、`metadata` 或 `compatibility` 字段

#### Scenario: 空结果响应
- **WHEN** 当前 Agent Scope 下没有可用 Skill
- **THEN** 系统 MUST 返回 `total=0`、`skills=[]` 的有效响应
- **AND** HTTP 状态码 MUST 为 200

### Requirement: Skill 列表查询的 Scope 与来源聚合

Skill 列表查询 MUST 通过现有 `CapabilityCatalog.listAvailable()` 聚合 SKILL capability，MUST NOT 绕过 catalog governance、conflict resolution 或 Agent assembly binding 检查。查询 MUST 使用当前 trusted Agent Scope 和当前 Owner Scope（由 Web channel identity resolver 决定的 `tenantId`、`subjectId`）。当前版本使用 hosted agent configuration 的 `activeAgentId` 作为 Agent Scope；此为单 Agent 模式限制，未来支持多 Agent 时需改为 session-bound `agentId`（见 design D5 已知限制）。查询 MUST 聚合 `BUNDLED`（builtin-skills）和 `LOCAL_DIRECTORY`（local-skills-system 和 local-skills-agent-owned）provider 的 Skill。在 REMOTE deployment mode 下，查询 MUST 额外返回已启用且已授权的 `SKILL_HUB` provider 的 Skill。`local-skills-agent-owned` provider 的 Skill MUST 经过 agent-owned source authorization 校验，未通过授权的 agent-owned Skill MUST NOT 出现在结果中。查询 MUST NOT 返回 disabled、unauthorized 或 unavailable provider 的 Skill。

#### Scenario: LOCAL 模式返回内置与本地 Skill
- **WHEN** `deployment.mode=LOCAL` 且系统配置了 `LOCAL_DIRECTORY` Skill source
- **THEN** `GET /api/v1/skills` 返回的 Skill MUST 来自 `BUNDLED` 或 `LOCAL_DIRECTORY` provider
- **AND** 响应中 MUST NOT 出现 `providerKind=SKILL_HUB` 的 Skill

#### Scenario: REMOTE 模式返回内置、本地与 SkillHub Skill
- **WHEN** `deployment.mode=REMOTE` 且系统同时配置了 `LOCAL_DIRECTORY` 和已启用的 `SKILL_HUB` provider
- **THEN** `GET /api/v1/skills` 返回的 Skill MAY 同时包含 `providerKind=BUNDLED`、`providerKind=LOCAL_DIRECTORY` 和 `providerKind=SKILL_HUB` 的 Skill
- **AND** 所有 Skill MUST 通过统一的 catalog governance 和 conflict resolution

#### Scenario: 禁用的 provider 不返回 Skill
- **WHEN** 某个 `SKILL_HUB` provider 被配置为 disabled 或因 credential 无效被 fail closed
- **THEN** `GET /api/v1/skills` 返回的结果 MUST NOT 包含该 provider 的 Skill
- **AND** 响应 MUST NOT 暴露该 provider 被禁用的原因或诊断信息

#### Scenario: 未授权的 agent-owned Skill 不返回
- **WHEN** `local-skills-agent-owned` provider 中存在 Skill，但当前请求未通过 agent-owned source authorization
- **THEN** `GET /api/v1/skills` 返回的结果 MUST NOT 包含该 provider 的 Skill
- **AND** 响应 MUST NOT 暴露授权失败的原因或诊断信息

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

### Requirement: Skill 列表查询安全与可观测

Skill 列表查询 MUST 通过 trusted Web channel identity resolver 解析身份，MUST NOT 从查询参数、request header 或 request body 接受 identity、agent、tenant 或 provider override。查询 MUST 使用当前 trusted Agent Scope。API MUST 对 unauthenticated 请求返回 401 safe error，对 unauthorized 请求返回 403 safe error，对 catalog unavailable 返回 503 safe error。API MUST NOT 暴露 raw catalog error、provider error、文件路径或 stack trace。端点访问 MUST 通过 structured logging 记录，且日志 MUST NOT 包含 prompt、模型输出、credential、高基数字段或 provider 私有信息。

#### Scenario: 未认证请求被拒绝
- **WHEN** 未认证的客户端发送 `GET /api/v1/skills`
- **THEN** 系统 MUST 返回 401 状态码和 safe error
- **AND** 错误响应 MUST NOT 暴露任何 catalog 或 provider 内部信息

#### Scenario: Catalog 不可用时 fail closed
- **WHEN** capability catalog 或 assembly registry 不可用导致查询失败
- **THEN** 系统 MUST 返回 503 状态码和 safe error
- **AND** 错误消息 MUST NOT 包含 raw error、stack trace 或文件路径

#### Scenario: 正常访问被安全记录
- **WHEN** 已认证用户成功查询 Skill 列表
- **THEN** 系统 MUST 记录 structured log entry
- **AND** 日志 MUST 仅包含 low-cardinality 字段（如 HTTP method、route、status family、agentId）
- **AND** 日志 MUST NOT 包含 skill 列表内容、provider 配置或 credential

### Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill

Web channel MUST 通过 `agent-contracts/runtime` 定义的 `SkillCatalogQueryPort` 查询 Skill 列表，MUST NOT 直接依赖 `CapabilityCatalog`、`AssemblyRegistry` 或 `agent-capability` 内部实现。`SkillCatalogQueryPort` MUST 由 `agent-app` composition 实现并注入。Port 实现 MUST 接收 `AbortSignal` 以支持取消。Web channel MUST 将 port 返回的 `SkillCatalogQueryResult` 投影为 HTTP 响应 DTO，MUST NOT 将 port 内部类型直接暴露给 HTTP 客户端。

#### Scenario: Web channel 使用注入的 port
- **WHEN** Web channel 收到 `GET /api/v1/skills` 请求
- **THEN** Web channel MUST 调用注入的 `SkillCatalogQueryPort.listSkills()` 方法
- **AND** Web channel MUST NOT 直接访问 `CapabilityCatalog` 或 `AssemblyRegistry`

#### Scenario: Port 查询支持取消
- **WHEN** 客户端在查询过程中断开连接
- **THEN** `SkillCatalogQueryPort.listSkills()` 接收的 `AbortSignal` MUST 被 abort
- **AND** 查询 MUST 安全终止，MUST NOT 产生 partial response 或泄漏资源
