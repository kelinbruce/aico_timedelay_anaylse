# agent-web-session-sharing

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：Session 管理
对应能力：F9 会话分享
优先级：P2

状态：assumption-ready
类型：实施 change
主要 owner：`agent-session`
协作 owner：`agent-channel-web`
依赖：`add-ts-local-session-store`、`add-ts-local-configured-auth`

目标：
- 支持会话分享：生成唯一 `shareToken`，有效期支持 `1d` / `7d` / `30d` / `forever`。
- 分享链接 read-only 展示问答对，不暴露 agent 思考过程、工具调用细节或用户 metadata。
- 记录 `shareToken`、`sessionId`、`sharedBy`、`expiresAt`。

规格输入：
- 分享记录命名为 `SessionShareRecord`，归 `agent-contracts/gateway`，字段为 `shareToken`、`sessionId`、`tenantId`、`subjectId`、`sharedBy`、`expiresAt?`、`createdAt`。
- `POST /api/v1/sessions/{sessionId}/share` 创建分享：校验 owner scope，生成唯一 `shareToken`，按请求参数 `validity`（`1d`/`7d`/`30d`/`forever`）计算 `expiresAt`。
- `shareToken` MUST 为不可猜测的随机 token（如 UUID v4 或 CSPRNG 生成），不得包含 `sessionId`、`tenantId` 或 `subjectId`。
- `GET /api/v1/sessions/shared/{shareToken}` 为公开端点（不需要 owner 认证），返回 read-only 问答对视图。
- read-only 视图 MUST 只包含 user message 和 agent final answer 的文本内容；MUST NOT 包含 agent thinking/reasoning、tool call arguments/results、capability invocation details、timeline events、user metadata（`tenantId`/`subjectId`）或 session metadata（`agentId`/`agentVersion`）。
- `expiresAt` 到期后分享链接 MUST 返回 404 safe error，不得返回任何 session 内容。
- `DELETE /api/v1/sessions/{sessionId}/share` 撤销分享：校验 owner scope，删除 `SessionShareRecord`。
- `GET /api/v1/sessions/{sessionId}/share` 查询当前 session 的分享状态：校验 owner scope，返回 `shareToken`、`expiresAt`、`createdAt`。
- 一个 session 同时只允许一个 active share；重复创建分享 MUST 覆盖旧 `shareToken`（旧链接失效）。
- `sharedBy` 只能来自 channel/auth boundary 的 `identityContext.subjectId`，不得来自客户端请求体。
- 分享创建和撤销 MUST 产生 audit event（`session.share.created`、`session.share.revoked`）。
- read-only 视图的 message 内容 MUST 经过 redaction policy。

契约输入：
- `SessionShareRecord`（`agent-contracts/gateway`）：新增 persistence DTO。
- `SessionShareStoreGateway`（`agent-contracts/gateway`）：新增 gateway logical port，按 `shareToken` 查询和按 `sessionId` + owner scope 查询/写入/删除。
- `SessionShareView`（`agent-channel-web`）：public Web DTO，只含问答对文本。
- audit event（`agent-contracts/observability`）：`session.share.created`、`session.share.revoked`。
- `identityContext`（`agent-contracts/core`）：`sharedBy` 来源。

实现约束：
- `agent-session` 拥有 share token 生命周期管理和 owner scope 校验。
- `agent-channel-web` 拥有 HTTP route、schema validation、safe error、DTO projection 和 read-only view projection。
- read-only view 的 message 过滤 MUST 在 `agent-channel-web` projection 层完成，不在 `agent-session` 内做。
- `SessionShareStoreGateway` 的持久化按 `sessionId` + owner scope 建立 scoped uniqueness（一个 session 一个 active share）。
- `shareToken` 查询索引按 `shareToken` 建立，不按 owner scope（公开端点无 owner context）。
- 分享端点 `GET /api/v1/sessions/shared/{shareToken}` 不经过 local auth middleware，但 MUST 经过 rate limiting 和 redaction。

非目标：
- 不定义分享链接的前端渲染样式或交互（由 `agent-web` 承载）。
- 不定义分享权限的细粒度控制（如只分享部分 message）。
- 不定义分享链接的访问统计或 analytics。
- 不定义跨 tenant 的分享（首版只支持同 deployment 内分享）。
- 不改变 session list、session detail 或 message 的已有 API 语义。

验收要点：
- contract test：`SessionShareRecord`、`SessionShareStoreGateway` 契约覆盖。
- security test：read-only 视图不包含 thinking/tool calls/user metadata。
- security test：`shareToken` 不可猜测，不包含 owner 信息。
- security test：`expiresAt` 到期后返回 404。
- security test：`sharedBy` 只来自 auth boundary，不接受客户端 override。
- integration test：重复创建分享覆盖旧 token，旧链接失效。
- architecture test：`agent-channel-web` 不直接操作 gateway persistence。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `Session` DO 或 `SessionRecord` 的已有字段（新增独立的 `SessionShareRecord`）。
- 不侵入 `SessionStoreGateway` 的已有 query/write 契约（新增独立的 `SessionShareStoreGateway`）。
- `agent-web-session-bookmark` 可并行推进，两者不耦合。
- 不侵入 `add-ts-local-configured-auth` 的 auth middleware 契约（分享端点绕过 auth，但复用 rate limiting）。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（rate limit 阈值、token 生成算法、read-only view 的 message 过滤规则）。
