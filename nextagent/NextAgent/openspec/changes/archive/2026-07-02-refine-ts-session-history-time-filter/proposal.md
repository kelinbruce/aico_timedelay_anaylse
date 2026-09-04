## 背景与问题（Why）

当前会话历史列表按 `updatedAt` 降序展示，用户实际感知的“历史时间”也是列表中的最近活动时间。但现有 `GET /api/v1/sessions` 时间范围筛选仍落在 `createdAt`。这会导致一个会话虽然创建时间落在范围内、最近活动时间却落在范围外时，仍被筛选结果返回，形成“按时间筛选历史时，将时间范围外的对话也筛选出来”的黑盒问题。

本变更的目标是把现有时间范围筛选语义对齐到会话列表已经公开展示的活动时间，不新增新的 public 查询参数，也不改变现有列表排序、分页、scope 隔离或文本搜索语义。

## 变更范围（What Changes）

- 保留现有 public 查询参数 `createdFrom` / `createdTo` 和内部 contract 字段 `createdAtFrom` / `createdAtTo`，避免扩大接口变更面。
- 将这组时间范围筛选的生效字段从会话创建时间 `createdAt` 调整为会话活动时间 `updatedAt` / public `lastActivityAt`。
- 保持时间范围仍为整数 epoch millis 闭区间，仍要求成对出现，仍限制最大跨度为 90 天。
- 保持列表排序仍为 `updatedAt` 降序、`sessionId` 升序；分页、去重、关键词搜索、Owner Scope 和 Agent Scope 规则不变。

## 影响范围（Impact）

- `session-history-search` 稳定规格需要把时间筛选语义从“创建时间”改为“活动时间/最后活动时间”。
- gateway-local `listSessions` SQL 过滤列需要从 `sessions.created_at` 切换到 `sessions.updated_at`。
- 现有网关黑盒测试需要更新，覆盖“创建时间在范围内但最后活动时间在范围外时必须排除”的边界。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-history-search/spec.md`：把时间范围过滤语义从创建时间更新为活动时间，并更新相关场景说明。

## 验证入口（Validation）

- `openspec validate refine-ts-session-history-time-filter --strict`
- 聚焦测试：`tests/agent-kernel/local-gateway-contract.test.ts`
