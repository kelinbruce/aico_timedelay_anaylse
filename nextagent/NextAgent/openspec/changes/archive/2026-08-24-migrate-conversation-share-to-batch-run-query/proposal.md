## Why

对话分享的创建和查看路径在解析多个选中 `runId` 时，对每个 run 各发起一次 `RequestRunStoreGateway.loadRun` 单记录查询。`ConversationShareService.createShare` 和 `loadSharedConversation` 都在循环内逐条调用 `resolveShareUnit`，而 `resolveShareUnit` 内部对每个 `runId` 调用一次 `runStore.loadRun`。选中 N 个 run 即产生 N 次串行 gateway 查询；在 REMOTE 部署中这对应 N 次远端 AgentMemory 请求，选中项较多时容易达到接口限流阈值，导致分享创建或查看失败。

`add-request-run-batch-query`（已合入）为 `RequestRunStoreGateway` 增加了必需的 `listRuns` 分页批量查询，单页最多返回 100 条并受可信 Owner Scope 和 Agent Scope 隔离。本 change 将对话分享路径迁移到该批量能力，把 N 次单记录查询收敛为一次批量查询。

同时，前端（`agent-web`）分享勾选模式当前对选中数量没有上限：`handleToggleShareSelection` 只做 add/delete，`handleToggleSelectAll` 直接全选所有可选项。100 上限此前只在后端 `createShareBody` schema 校验（`maxItems: 100`）兜底，用户在长会话中可勾选超过 100 项，直到点击分享才被后端 400 拒绝。`listRuns` 的单页 `limit` 上限为 100，前端必须在勾选阶段就限制选中数量，使分享所选 runId 集合与批量查询的单页容量对齐。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 对话分享创建和查看路径 MUST 在解析选中 `runIds` 时使用一次 `RequestRunStoreGateway.listRuns` 批量查询替代循环内逐条 `loadRun`，从 N 次 gateway 调用降为 1 次。
- 前端（`agent-web`）分享勾选模式 MUST 在勾选阶段将选中数量限制为不超过 100，与分享创建 Web API 的 `runIds` `maxItems` 和 `listRuns` 单页 `limit` 上限一致。
- 分享解析的行为契约（scope 校验、attempt 精度、fork copied run anchor 回退、`SHARE_CONTENT_DELETED` / `SHARE_RUN_NOT_RESOLVABLE` 语义）保持不变。

**非目标：**

- 不新增 Web API，不改变创建分享或查看分享的公开响应结构、错误码和 copied run anchor 回退语义。
- 不改变 `loadRun` 单记录查询的行为，也不迁移 runtime lifecycle 中天然按单个运行读取的其他调用点。
- 不改变 `listRuns` gateway 契约本身（由 `add-request-run-batch-query` 定义）。
- 不引入分页循环：分享所选 runId 集合受前端 100 上限约束，单次 `listRuns(limit: runIds.length)` 即可解析全部选中 run，不需要遍历多页。
- 不修改 `ConversationShareRecord` 结构或 `runIds` 冻结快照语义。

## What Changes

- `ConversationShareService.createShare` 和 `loadSharedConversation` 在循环解析 share unit 前，MUST 一次调用 `listRuns({ runIds, offset: 0, limit: runIds.length })` 获取当前 scope 下全部选中 run 的 `RequestRunRecord`，构建 `runId -> RequestRunRecord` 的 Map；`resolveShareUnit` 改为从该 Map 取记录替代循环内 `loadRun`。
- 当 `listRuns` 返回的页不含某 `runId` 时，分享解析 MUST 沿用原 `loadRun === undefined` 的 fork copied run anchor 回退分支（selected run messages 无 `RequestRunRecord` 但可读且能唯一补齐 canonical USER + assistant answer 时仍可解析）。
- 前端（`agent-web`）分享勾选 MUST 将选中集合大小限制为不超过 100：逐项勾选时已达上限 MUST 拒绝继续新增并给出提示；全选时 MUST 截断为前 100 个可选项并提示。
- 前端限制常量 MUST 与后端 `WEB_SHARE_RUN_IDS_MAX_ITEMS`（100）同值，由 `agent-web` 边界独立持有，不跨包 import。

## Capability 影响（OpenSpec Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `conversation-share` → `specs/conversation-share/spec.md`
  - 功能边界：分享 run 解析从逐条 `loadRun` 改为单次 `listRuns` 批量查询；前端勾选选中数量上限为 100。
  - 系统质量属性：性能/容量、可靠性/恢复、可测试性、可维护性。

## 影响范围（Impact）

- 代码：`packages/agent-session/src/services/conversation-share-service.ts`（service 迁移）、`frontend/agent-web`（`ChatPage.tsx` 勾选上限 + `ShareModeBar` 计数展示 + 限制常量）。
- API：无 Web API 变更。`POST /api/v1/sessions/:sessionId/shares` 和 `GET /api/v1/shares/:shareId/conversation` 的请求/响应 shape 不变。
- 契约：消费已有 `RequestRunStoreGateway.listRuns`（`add-request-run-batch-query` 引入），不修改 gateway contract。
- 测试：`agent-session` 现有分享测试通过 `createSqliteGatewayStores` 真实 SQLite gateway 运行，`listRuns` 已实现，迁移后测试断言批量解析结果与原逐条解析等价；新增断言 `loadRun` 不再被循环调用的负例测试和前端 100 上限边界测试。
- 配置/运维：无新增配置。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-share/spec.md`：在「Frontend share interaction behavior」requirement 中补充勾选 100 上限约束；新增分享 run 批量解析 requirement。

**长期背景：**
- 无（分享行为不变，仅解析方式和前端选中上限变化）。

**设计视图：**
- 无。

**验证入口：**
- `agent-session` 测试：分享创建/查看批量解析等价、`loadRun` 不被循环调用。
- `frontend/agent-web` 测试：勾选 100 上限边界、全选截断。
