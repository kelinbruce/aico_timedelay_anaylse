# agent-web-user-personalization

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：AgentWeb 前端 / Session
对应能力：F18 用户个性化配置
优先级：P2

状态：assumption-ready
类型：实施 change
主要 owner：`agent-web`
协作 owner：`agent-session`
依赖：`add-ts-local-session-store`、`add-ts-redaction-policy`

目标：
- 新增 `user_profile` 存储，关联 owner scope。
- 支持字段 `role` + `knowledgePreferences`（最多 50 条）。
- 前端支持手动添加（最多 10 条）和 json 文件导入（最多 50 条）。
- 个性化信息作为 context 输入 model，经过 redaction policy。

规格输入：
- 用户画像持久化记录命名为 `UserProfileRecord`，归 `agent-contracts/gateway`，字段为 `tenantId`、`subjectId`、`role?: string`、`knowledgePreferences: KnowledgePreference[]`、`updatedAt`。
- 每个 `KnowledgePreference` 包含 `label: string`（展示文本）、`tags?: string[]`（标签数组）。
- `UserProfileRecord` 按 `tenantId` + `subjectId` 建立 scoped uniqueness（一个 owner 一个 profile）。
- `GET /api/v1/user/profile` 返回当前 owner 的 profile；`PUT /api/v1/user/profile` 更新 profile（整体替换 `role` 和 `knowledgePreferences`）。
- `knowledgePreferences` 总数上限 50 条；单条 `label` 上限 200 字符；`tags` 单条上限 10 个、单个 tag 上限 50 字符。
- 手动添加场景（前端表单）单次最多添加 10 条；json 文件导入场景单次最多导入 50 条（覆盖已有）。
- `role` 上限 200 字符；`role` 和 `knowledgePreferences` 内容 MUST 经过 redaction policy。
- 个性化信息在每个 request acceptance 时作为 context 输入传递给 context engine，由 context engine 决定是否纳入 model context。
- 个性化信息的 context 注入 MUST 经过 redaction policy，不得把 raw sensitive content 传入 model context 或写入 audit。
- `UserProfileRecord` 的 `tenantId` 和 `subjectId` 只能来自 channel/auth boundary 的 `identityContext`，不得来自客户端请求体。
- profile 更新 MUST 产生 audit event（`user.profile.updated`）。

契约输入：
- `UserProfileRecord`（`agent-contracts/gateway`）：新增 persistence DTO。
- `UserProfileStoreGateway`（`agent-contracts/gateway`）：新增 gateway logical port，按 owner scope 查询/写入。
- `KnowledgePreference`（`agent-common` 或 `agent-contracts/gateway`）：知识偏好结构。
- `ContextAssemblyRequest`（`agent-contracts/context`）：扩展可选 `userProfile?: UserProfileContext` 字段。
- `UserProfileContext`（`agent-contracts/context`）：context engine 消费的精简结构（`role?`、`knowledgePreferences`），不含 `tenantId`/`subjectId`。
- audit event（`agent-contracts/observability`）：`user.profile.updated`。
- `identityContext`（`agent-contracts/core`）：owner scope 来源。

实现约束：
- `agent-session` 拥有 user profile 的持久化管理和 owner scope 校验。
- `agent-channel-web` 拥有 HTTP route、schema validation、safe error 和 DTO projection。
- `agent-context-engine` 消费 `UserProfileContext` 并决定是否纳入 model context，不直接访问 `UserProfileStoreGateway`。
- `UserProfileStoreGateway` 的持久化按 `tenantId` + `subjectId` 建立 scoped uniqueness，复用 gateway-local SQLite store。
- profile 内容的 redaction MUST 在写入 gateway 前和注入 context 前各执行一次。
- json 文件导入 MUST 经过 schema validation 和 redaction，非法格式返回 safe error。
- context engine 纳入 `UserProfileContext` 时 MUST 遵守 context budget 约束（`add-ts-context-budget-explainability`），不因 profile 内容超出 budget。

非目标：
- 不定义用户画像的自动提取或模型生成（由 `add-ts-memory-extraction` 承载）。
- 不定义 user profile 的跨 tenant 共享或数据搬迁。
- 不定义 profile 的版本历史或回滚。
- 不定义 profile 对 capability routing 或 model selection 的影响（首版只影响 context input）。
- 不定义 profile 的 analytics 或统计。
- 不改变 context engine 的已有 budget、compression 或 shaping 契约（只新增可选 input）。

验收要点：
- contract test：`UserProfileRecord`、`UserProfileStoreGateway`、`UserProfileContext` 契约覆盖。
- security test：`tenantId`/`subjectId` 只来自 auth boundary，不接受客户端 override。
- security test：profile 内容经过 redaction，不包含 raw sensitive content 在 audit 或 model context 中。
- integration test：`knowledgePreferences` 上限 50 条、`label` 上限 200 字符的 validation。
- integration test：json 文件导入的 schema validation 和 safe error。
- architecture test：`agent-context-engine` 不直接依赖 `UserProfileStoreGateway`。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `ContextAssemblyRequest` 的冻结核心字段（只新增可选 `userProfile?`）。
- 不侵入 `SessionStoreGateway` 的已有 query/write 契约（新增独立的 `UserProfileStoreGateway`）。
- 不侵入 `agent-context-engine` 的已有 budget/compression/shaping 逻辑（只新增可选 input）。
- 不侵入 `add-ts-redaction-policy` 的已有契约（只消费 redaction）。
- `agent-web-session-bookmark`、`agent-web-session-sharing` 可并行推进，三者不耦合。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（context budget 分配比例、json 导入格式、redaction 策略）。
