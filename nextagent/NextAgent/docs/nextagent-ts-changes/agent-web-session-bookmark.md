# agent-web-session-bookmark

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：Session 管理
对应能力：F8 会话收藏
优先级：P2

状态：assumption-ready
类型：实施 change
主要 owner：`agent-session`
协作 owner：`agent-channel-web`
依赖：`ship-ts-minimal-agent-kernel`、`add-ts-local-session-store`

目标：
- 支持会话收藏：`POST/DELETE /api/v1/sessions/{sessionId}/bookmark` + `GET /api/v1/sessions?bookmarked=true`。
- 收藏的 session 排除在 session aging 之外（当 aging 实现时生效）。
- 所有操作遵守 owner scope 校验。
- 收藏状态记录 audit event。

规格输入：
- Session 增加 `bookmarkedAt?: string`（ISO 8601 timestamp）字段；未收藏时为 `undefined`，收藏时写入当前时间。
- `POST /api/v1/sessions/{sessionId}/bookmark` MUST 校验 owner scope（`tenantId` + `subjectId`），非 owner session 返回 safe error。
- `DELETE /api/v1/sessions/{sessionId}/bookmark` MUST 校验 owner scope；清除 `bookmarkedAt`。
- `GET /api/v1/sessions?bookmarked=true` MUST 只返回当前 owner scope 下 `bookmarkedAt` 非 `undefined` 的 session，按 `bookmarkedAt` 降序排列。
- bookmark 操作 MUST NOT 修改 session 的 `title`、`agentId`、`lastActivityAt` 或 message/run 历史。
- `bookmarkedAt` 只能来自 owner 主动操作，不得来自模型输出、capability 参数或客户端 metadata override。
- 收藏状态变化 MUST 产生 audit event（`session.bookmark.added`、`session.bookmark.removed`）。
- `bookmarkedAt` 字段在 `SessionRecord`（gateway persistence DTO）中持久化，归 `agent-contracts/gateway`。
- Web DTO 中 `bookmarkedAt` 作为 public alias 在 `agent-channel-web` projection 层出现。
- session aging 目前为 `not-planned`（`add-ts-session-aging-policy`）；当 aging 未来实现时，`bookmarkedAt` 非 `undefined` 的 session MUST 排除在 aging 处理之外。本 change 只定义 bookmark 字段和 API，不实现 aging 逻辑。

契约输入：
- `SessionRecord`（`agent-contracts/gateway`）：新增 `bookmarkedAt?: string`。
- `Session`（`agent-contracts/session`）：DO 层增加 `bookmarkedAt?: string`。
- Session Web DTO（`agent-channel-web`）：`bookmarkedAt` 作为 public alias。
- `SessionStoreGateway`（`agent-contracts/gateway`）：bookmark 写入复用 session record update（CAS by `sessionId` + owner scope）。
- audit event（`agent-contracts/observability`）：`session.bookmark.added`、`session.bookmark.removed`。

实现约束：
- `agent-session` 拥有 bookmark 状态管理和 owner scope 校验。
- `agent-channel-web` 只负责 HTTP route、schema validation、safe error 和 DTO projection。
- bookmark 写入 MUST 使用 `SessionStoreGateway` 的 session record update，不在 `agent-session` 内直接操作 SQLite row。
- `bookmarkedAt` 的持久化复用现有 session record 的 CAS 写入语义（`expectedVersion`），不新增独立 bookmark store。
- `GET /api/v1/sessions?bookmarked=true` 复用现有 session list query，增加 `bookmarked` filter，不新增独立 query port。

非目标：
- 不实现 session aging 或 retention 逻辑（`add-ts-session-aging-policy` 为 `not-planned`）。
- 不定义 bookmark 的分类、标签或备注。
- 不定义跨 owner 的 bookmark 共享（由 `agent-web-session-sharing` 承载）。
- 不改变 session list 的默认排序和分页语义。

验收要点：
- contract test：`SessionRecord.bookmarkedAt` 字段契约覆盖。
- integration test：`POST/DELETE bookmark` 的 owner scope 校验和 safe error。
- integration test：`GET /api/v1/sessions?bookmarked=true` 只返回 bookmarked session。
- architecture test：`agent-channel-web` 不直接操作 gateway persistence。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `Session` DO 的冻结核心字段（只新增可选 `bookmarkedAt?`）。
- 不侵入 `SessionStoreGateway` 的已有 query/write 契约（复用 CAS update 和 list filter）。
- `agent-web-session-sharing` 可并行推进，两者不耦合。
- 不依赖 `add-ts-session-aging-policy`（`not-planned`），aging 排除为前向约束。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（bookmark 列表分页上限、排序规则）。
