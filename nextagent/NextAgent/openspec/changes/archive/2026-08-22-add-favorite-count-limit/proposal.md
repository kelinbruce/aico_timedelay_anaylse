## 背景与问题（Why）

对话标注能力（`openspec/specs/conversation-annotation/spec.md`）的收藏（`isFavorited`）当前没有任何数量上限：同一 `(tenantId, subjectId, agentId)` scope 下用户可以无限收藏对话轮次。在电信网络运维场景中，这带来两个实际问题：
对话标注能力（`openspec/specs/conversation-annotation/spec.md`）的收藏（`isFavorited`）当前没有任何数量上限：同一 `(tenantId, subjectId)` scope（即单用户）下可以无限收藏对话轮次。在电信网络运维场景中，这带来两个实际问题：

- **容量与存储失控**：无上限的收藏事实会无限增长 `conversation_annotations` 表行数与收藏列表查询、会话老化豁免判定的开销，缺少容量闸门。
- **治理语义缺失**：电信级质量要求容量可治理；收藏作为用户可见的持久化事实，必须有确定性的数量约束和可验证的拒绝行为，避免无界增长冲击列表分页与老化豁免扫描。

本 change 为收藏引入固定上限：每个 agent scope 最多 100 个收藏。限制由持久化层权威 enforce，客户端只做投影。
本 change 为收藏引入固定上限：每个用户（`(tenantId, subjectId)` scope）最多 100 个收藏，跨所有 agent 共享配额。local 宿主由持久化层事务内权威 enforce；remote 宿主无 gateway enforce 能力，由前端在收藏前查询列表数量做前置检查，超限直接展示友好提示。

## 变更范围（What Changes）

- `agent-platform-gateway-local` 的 `conversation_annotations` 持久化在 `saveAnnotation` 事务内新增收藏计数上限校验：同一 `(tenantId, subjectId, agentId)` scope 下 `is_favorited=1` 的行数达到 100 时，拒绝净新增收藏的写入。校验与写入在同一 SQLite 事务内完成，无 TOCTOU 竞态。
- `agent-platform-gateway-local` 的 `conversation_annotations` 持久化在 `saveAnnotation` 事务内新增收藏计数上限校验：同一 `(tenantId, subjectId)` scope（单用户，跨所有 agent）下 `is_favorited=1` 的行数达到 100 时，拒绝净新增收藏的写入。校验与写入在同一 SQLite 事务内完成，无 TOCTOU 竞态。
- 上限只在净新增收藏时触发：INSERT 且 `isFavorited=true`、或 UPDATE 将 `isFavorited` 从 false 翻转为 true 时校验；取消收藏、对已收藏行重新收藏（true→true）、单独更新 sentiment/comment 一律放行。supersede 清理和会话删除级联会自然释放配额，无需额外处理。
- 超限拒绝复用既有 SafeError 通道：gateway 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`；`agent-session` 既有 `isSafeError` 逻辑自动转为 `AgentError`；`agent-channel-web` 既有 `statusFor` 将 `VALIDATION` 映射为 HTTP `400`。
- 超限拒绝复用既有 SafeError 通道：gateway 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`；`agent-session` 既有 `isSafeError` 逻辑自动转为 `AgentError`；`agent-channel-web` 既有 `statusFor` 将 `VALIDATION` 映射为 HTTP `400`。此为 local 宿主的权威 enforce 路径。
- `frontend/agent-web` remote 宿主（`immersive`/`piu` 模式）在收藏前先查询 `listFavoriteTurns(limit=100)`，若 `entries.length >= 100` 则不发 upsert 请求，直接回滚乐观状态并展示专门的数量超限提示（i18n key `turn.favoriteLimitError`）。local 宿主不做前置查询，依赖 gateway 事务 enforce + 错误回滚。remote 前置检查是受控例外：远端无 gateway 事务 enforce 能力，接受 check-then-insert 的 ≤100 近似语义。
- `frontend/agent-web` 收到 `FAVORITE_LIMIT_EXCEEDED` 错误后回滚乐观收藏状态，并展示专门的数量超限提示（i18n），而非通用标注错误文案。
- `frontend/agent-web` local 宿主收到 `FAVORITE_LIMIT_EXCEEDED` 错误后回滚乐观收藏状态，并展示专门的数量超限提示（i18n key `turn.favoriteLimitError`），而非通用标注错误文案。
- 上限为固定常量 100，不引入配置项。`isQuestionFavorited` 不在本 change 范围内，不受上限约束。
- 上限为固定常量 100，不引入配置项。scope 为 `(tenantId, subjectId)`，跨所有 agent 共享配额。`isQuestionFavorited` 不在本 change 范围内，不受上限约束。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `conversation-annotation`: 新增收藏数量上限行为契约（上限数值、scope、enforce 位置与时机、超限安全错误、Web 投影、前端提示行为）。
- `conversation-annotation`: 新增收藏数量上限行为契约（上限数值、scope `(tenantId, subjectId)`、local enforce 位置与时机、remote 前置检查、超限安全错误、Web 投影、前端提示行为）。

## 影响范围（Impact）

- 代码：`packages/agent-platform-gateway-local`（`saveAnnotation` 事务内计数校验 + 常量）、`frontend/agent-web`（`TurnBlock` 错误区分与提示、i18n）。
- 代码：`packages/agent-platform-gateway-local`（`saveAnnotation` 事务内计数校验 + 常量，scope 去掉 `agentId`）、`frontend/agent-web`（`TurnBlock` remote 前置检查 + 错误区分与提示、i18n）。
- API：`POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 新增一种安全错误响应 `FAVORITE_LIMIT_EXCEEDED`（HTTP 400）；无 schema 变更。
- 测试：`agent-platform-gateway-local` 收藏上限 unit 测试（边界、scope 隔离、无 side effect、幂等放行）、`agent-channel-web` 错误透传测试、`frontend/agent-web` 超限提示组件测试。
- 测试：`agent-platform-gateway-local` 收藏上限 unit 测试（边界、跨 agent 共享配额、无 side effect、幂等放行）、`agent-channel-web` 错误透传测试、`frontend/agent-web` 超限提示组件测试（remote 前置检查 + local 错误回滚）。
- 配置/运维：无新增配置；超限拒绝可通过既有 safe error code 与 runtime 日志观测。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-annotation/spec.md`：合并「收藏数量上限」requirement。

**长期背景：**
- `openspec/overview.md`：在稳定基线描述中为收藏补充「每 agent scope 最多 100 个收藏上限」一句。
- `openspec/overview.md`：在稳定基线描述中为收藏补充「每用户最多 100 个收藏上限（跨所有 agent 共享配额）」一句。

**设计视图：**
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充收藏计数上限常量、事务内 enforce 语义。
- `openspec/designs/spec-to-design-map.md`：无（conversation-annotation 导航已存在）。

**验证入口：**
- `agent-platform-gateway-local` unit test：收藏上限边界、scope 隔离、净新增判定、无 side effect、幂等放行。
- `agent-platform-gateway-local` unit test：收藏上限边界、跨 agent 共享配额、净新增判定、无 side effect、幂等放行。
- `agent-channel-web` route integration test：超限响应 400 + 错误码 + 无敏感信息泄漏。
- `frontend/agent-web` 前端 test：超限回滚与专门提示。
