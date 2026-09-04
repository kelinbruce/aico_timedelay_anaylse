## 背景和现状（Context）

收藏对话列表查询链路：前端 `annotationService.listFavoriteTurns` → `GET /api/v1/favorites` → `ConversationAnnotationService.listFavoriteTurns` → gateway `annotationStore.listFavoriteTurns`（SQL）→ `collectFavoriteTurnPage`（应用层补数据）。

gateway SQL（`sqlite-gateway-core.ts:4412-4419`）已通过 `LEFT JOIN messages` 获取用户问题预览（`questionPreview`），但未 JOIN `sessions` 表，无法产出 `sessionTitle` 和 `sessionUpdatedAt`。gateway DTO `ConversationFavoriteTurnSummary`（`gateway/index.ts:1654-1660`）只有 6 个字段，缺这两个。runtime DTO `ConversationFavoriteTurnEntry`（`runtime/index.ts:1360-1369`）需要这两个字段。应用层 `collectFavoriteTurnPage`（`conversation-annotation-service.ts:144-163`）被迫对每条 summary 调用 `sessionStore.loadSession()` 逐条补齐，产生 N+1。

约束：

- AGENTS.md 规格优先：修改 gateway contract（`ConversationFavoriteTurnSummary`）前必须先有 OpenSpec change（本 change）。
- 同形同策：`listFavoriteTurns` SQL 已有 `LEFT JOIN messages` 模式获取关联数据；补 `LEFT JOIN sessions` 是同一模式的自然延伸，不需要新增批量 port 方法。
- 最小内核非回归：不修改 conversation 历史响应形状、不修改 annotation upsert 语义。
- 简单优先：选择 SQL JOIN 而非新增 `SessionStoreGateway.loadSessions` 批量方法，因为 `sessionTitle`/`sessionUpdatedAt` 只在收藏列表查询上下文需要，不是通用批量加载需求。

相关方：`agent-contracts`（gateway DTO）、`agent-platform-gateway-local`（SQL）、`agent-session`（service）、`agent-app`（composition）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- gateway `listFavoriteTurns` / `listQuestionFavoriteTurns` 在单次 SQL 查询中通过 `LEFT JOIN sessions` 返回 `sessionTitle` 和 `sessionUpdatedAt`。
- `ConversationFavoriteTurnSummary` 包含 `sessionTitle?: string` 和 `sessionUpdatedAt: EpochMillis`。
- `collectFavoriteTurnPage` 直接消费 Summary 字段，消除 per-summary `loadSession` 调用，从 1+N 次网关调用降为 1 次。

**非目标：**

- 不新增 `SessionStoreGateway.loadSessions` 批量 port 方法（KISS：JOIN 是此查询的既定模式）。
- 不修改 `ListFavoriteTurnsQuery` 缺 `keyword`/`favoritedFrom`/`favoritedTo` 导致 channel 层拉 100 条内存过滤的问题（独立问题，不在本 change 范围）。
- 不修改 Web channel 投影和前端消费逻辑（已支持这两个字段）。
- 不修改 runtime DTO `ConversationFavoriteTurnEntry`（字段不变）。

## 设计决策（Decisions）

### D1：选择 SQL JOIN 而非批量 port 方法

`listFavoriteTurns` SQL 已有 `LEFT JOIN messages` 模式获取用户问题预览。补 `LEFT JOIN sessions` 获取 session title 和 updated_at 是同一模式的最小延伸。对比新增 `SessionStoreGateway.loadSessions` 批量方法：

- JOIN 方案：1 次 SQL 查询，改动小（SQL + DTO + service），无需新 port 方法、新 request type、新实现。
- 批量方法方案：2 次 SQL 查询（list + batch load），改动大（新 port、新 request、新实现、新测试），且 `sessionTitle`/`sessionUpdatedAt` 只在收藏列表上下文需要，不是通用需求。

同形同策：`listFavoriteTurns` 的 SQL JOIN messages 和 JOIN sessions 是同类操作（在列表查询中 JOIN 关联表获取投影字段），使用同一模式。

### D2：字段映射与回退

- `s.title AS session_title` → `sessionTitle: string | undefined`：LEFT JOIN sessions 可能无匹配行（session 被删除但 annotation 行残留），此时 `session_title` 为 `null`，映射为 `undefined`。应用层回退 `'Untitled session'`，与现有逻辑一致。
- `s.updated_at AS session_updated_at` → `sessionUpdatedAt: EpochMillis`：无匹配时 `session_updated_at` 为 `null`，回退 `brand(0)`，与现有 `sessionRecord?.updatedAt ?? brand(0)` 一致。

### D3：collectFavoriteTurnPage 签名简化

消除 N+1 后，`collectFavoriteTurnPage` 不再需要 `identityContext` 和 `agentId` 参数（仅用于 `loadSession` 的 scope 参数）。但为避免调用方 `listFavoriteTurns`/`listQuestionFavoriteTurns` 签名变更引入不必要改动，保留参数但标记为不再使用。实际选择是直接简化签名移除这两个参数，因为调用方就在同一文件内，改动范围可控。

### D4：移除 sessionStore 依赖

`sessionStore` 在 `ConversationAnnotationService` 中仅被 `collectFavoriteTurnPage` 使用。消除 N+1 后，从 `ConversationAnnotationServiceDependencies` 移除 `sessionStore`，并同步调整 `agent-app` composition 装配。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 性能/容量 | 从 1+N 次网关调用降为 1 次 SQL 查询；消除并发限流风险 | gateway 契约测试 + service 单元测试 |
| 安全 | JOIN 使用 owner scope + agent scope 条件，不泄露跨 scope 数据 | 既有 scope 隔离测试不退化 |
| 可靠性/恢复 | LEFT JOIN 保证 session 不存在时不丢失 annotation 行，回退值与原逻辑一致 | session 不存在的边界测试 |
| 可维护性 | 消除 N+1 anti-pattern，减少跨 package 依赖（session → sessionStore） | `npm run lint:architecture` |
| 可测试性 | Summary 字段和 N+1 消除均可通过现有测试基建验证 | 契约测试 + 单元测试 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Summary 包含 sessionTitle/sessionUpdatedAt | T1, T2 | gateway 契约测试 |
| SQL 通过 LEFT JOIN sessions 带出字段 | T2 | gateway 契约测试 |
| collectFavoriteTurnPage 不调用 loadSession | T3 | service 单元测试 |
| session 不存在时回退值正确 | T2, T3 | 边界测试 |
| 移除 sessionStore 依赖后 build/architecture 通过 | T4 | `npm run build` + `npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/conversation-annotation/spec.md`（归档时在「Annotation list and query behavior」requirement 中补充 gateway 实现约束）。
- 架构和跨模块设计：无。
- 模块设计：无。
- ADR：无。
- 导航：无。

## 风险与取舍（Risks / Trade-offs）

- [LEFT JOIN sessions 增加单次查询的 JOIN 数量] -> 可接受：sessions 表按 `(tenant_id, subject_id, agent_id, session_id)` 有索引，JOIN 开销远小于 N 次独立查询。
- [移除 sessionStore 依赖可能影响其他消费方] -> 已确认 `sessionStore` 在 `ConversationAnnotationService` 中仅被 `collectFavoriteTurnPage` 使用，无其他消费方。

## 迁移计划（Migration）

无数据迁移。SQL 查询修改对存量数据立即生效，无持久化格式变化。回滚即还原代码。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/conversation-annotation/spec.md`：在「Annotation list and query behavior」requirement 中补充：gateway `listFavoriteTurns`/`listQuestionFavoriteTurns` SHALL 通过 LEFT JOIN `sessions` 表在单次查询中返回 `sessionTitle` 和 `sessionUpdatedAt`，MUST NOT 在应用层对每条 summary 单独回查 session。

## 待确认问题

无。
