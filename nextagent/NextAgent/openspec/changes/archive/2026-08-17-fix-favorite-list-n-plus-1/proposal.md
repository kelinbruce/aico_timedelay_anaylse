## 背景与问题（Why）

收藏对话列表 `listFavoriteTurns` / `listQuestionFavoriteTurns` 的 gateway SQL（`sqlite-gateway-core.ts`）只通过 `LEFT JOIN messages` 获取用户问题预览，**未 JOIN `sessions` 表**，导致 `ConversationFavoriteTurnSummary` 不包含 `sessionTitle` 和 `sessionUpdatedAt`。应用层 `ConversationAnnotationService.collectFavoriteTurnPage` 被迫对每条 summary 单独调用 `sessionStore.loadSession()` 补齐这两个字段，产生经典 N+1 查询：1 次列表查询 + N 次 session 查询。

当并发用户量大时，网关调用次数 = M 用户 × (1 + N) 次，可能远超后端持久化层或远程 HTTP 网关的并发限流阈值，导致请求被拒绝、收藏列表加载失败。

OpenSpec spec（`openspec/specs/conversation-annotation/spec.md` 第 122 行）已明确要求收藏列表每条返回 `sessionTitle` 和 `sessionUpdatedAt`，但 gateway 实现未在单次查询中带出这两个字段，应用层通过 N+1 补数据满足规格要求。

## 变更范围（What Changes）

- `agent-contracts` gateway DTO `ConversationFavoriteTurnSummary` 增补 `sessionTitle?: string` 和 `sessionUpdatedAt: EpochMillis` 两个字段。
- `agent-platform-gateway-local` 的 `listFavoriteTurns` 和 `listQuestionFavoriteTurns` SQL 补 `LEFT JOIN sessions` 一次查询带出 `s.title` 和 `s.updated_at`。
- `agent-session` 的 `ConversationAnnotationService.collectFavoriteTurnPage` 消除 per-summary `loadSession` 循环，直接消费 Summary 字段。
- `agent-session` 的 `ConversationAnnotationServiceDependencies` 移除不再需要的 `sessionStore` 依赖。
- `agent-channel-web` 和 `frontend/agent-web` 无需改动（投影和消费逻辑已支持这两个字段）。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `conversation-annotation`: 收藏列表查询的 gateway 实现从 N+1 补数据改为单次 JOIN 查询，行为契约不变（返回字段和语义不变），新增 gateway 实现约束（MUST 通过 LEFT JOIN sessions 在单次查询中返回 sessionTitle/sessionUpdatedAt，MUST NOT 在应用层 per-summary 回查 session）。

## 影响范围（Impact）

- 代码：`packages/agent-contracts`（gateway DTO 扩展）、`packages/agent-platform-gateway-local`（SQL 修改）、`packages/agent-session`（service 重写 + 依赖清理）、`packages/agent-app`（composition 装配调整）。
- API：无 API 变更。`GET /api/v1/favorites` 响应 shape 不变（`sessionTitle`/`sessionUpdatedAt` 已在投影中透传）。
- 测试：`agent-platform-gateway-local` 契约测试验证 Summary 字段；`agent-session` 单元测试验证无 N+1 调用。
- 配置/运维：无新增配置。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-annotation/spec.md`：在「Annotation list and query behavior」requirement 中补充 gateway 实现约束（LEFT JOIN sessions、MUST NOT 应用层 N+1 补数据）。

**长期背景：**
- 无（收藏列表行为不变，仅实现方式优化）。

**设计视图：**
- 无（SQL 查询实现细节不在 design module 层级记录）。

**验证入口：**
- `agent-platform-gateway-local` 契约测试：Summary 包含 sessionTitle/sessionUpdatedAt。
- `agent-session` 单元测试：收藏列表不触发 N+1 loadSession。
