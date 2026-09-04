## 1. 规格与实现对齐

- [x] 1.1 更新 `session-history-search` change delta，明确 `createdFrom` / `createdTo` 的过滤语义对齐到会话活动时间 `updatedAt` / `lastActivityAt`，并补充越界会话排除场景。
  验证：`openspec validate refine-ts-session-history-time-filter --strict`

## 2. 实现与验证

- [x] 2.1 调整 `packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts` 的 `listSessions` SQL 过滤列，从 `sessions.created_at` 切换为 `sessions.updated_at`，保持其他排序、分页、去重和 scope 条件不变。
  验证：更新 `tests/agent-kernel/local-gateway-contract.test.ts`，断言活动时间范围外的会话不会被返回。

- [x] 2.2 保持 Web route 和现有 query 参数形状不变，确认 `createdFrom` / `createdTo` 仍被校验并转发到 runtime query。
  验证：`packages/agent-channel-web/tests/session-list-search-route.test.ts`
