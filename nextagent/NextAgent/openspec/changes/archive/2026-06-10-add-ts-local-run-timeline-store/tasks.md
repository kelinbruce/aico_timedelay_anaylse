# add-ts-local-run-timeline-store — 任务

## 1. claimRun 实现

- [x] 1.1 实现 `claimRun(request: ClaimRunRequest)` — 接受 `ClaimRunRequest` 参数（tenantId, subjectId, runId, expectedVersion, lockedBy, lockExpiresAt），不再是无参 stub
- [x] 1.2 claimRun 逻辑：UPDATE request_runs SET locked_by + lock_expires_at + version+1 + updatedAt WHERE PK + scope + version=expectedVersion → 影响行数 0 返回 VERSION_CONFLICT 或 NOT_FOUND，1 返回 UPDATED
- [x] 1.3 验证：`npm run build` + `npm test` 通过

## 2. listRecoverableRuns 实现

- [x] 2.1 实现 `listRecoverableRuns(request: SystemListRecoverableRunsRequest)` — 接受 `now` + `limit` 参数，不再是无参 stub
- [x] 2.2 listRecoverableRuns 逻辑：SELECT json FROM request_runs WHERE status IN (active statuses) AND terminal_commit_state IN ('NOT_STARTED', 'PENDING', 'RETRYING') ORDER BY created_at ASC LIMIT limit
- [x] 2.3 验证：`npm run build` + `npm test` 通过

## 3. Terminal commit 幂等语义测试

- [x] 3.1 ALREADY_COMMITTED 幂等 — 同 idempotencyKey 二次 commitTerminal → ALREADY_COMMITTED，listEvents 不产生重复 timeline event
- [x] 3.2 事务回滚重试安全 — 模拟 version conflict 导致 commitTerminal 失败 → 同 idempotencyKey 可重试（若 version 再次匹配）
- [x] 3.3 验证：`npm run build` + `npm test` 通过

## 4. Terminal commit 恢复语义测试

- [x] 4.1 崩溃恢复一致性 — commitTerminal 成功后新建 SqliteGatewayStores（同 DB 文件）→ loadRun 返回 COMMITTED → listRecoverableRuns 不返回该 run
- [x] 4.2 未提交 run 恢复发现 — run 状态 EXECUTING/PENDING → 新建 SqliteGatewayStores → listRecoverableRuns 包含该 run
- [x] 4.3 验证：`npm run build` + `npm test` 通过

## 5. RequestRunStoreGateway contract tests

- [x] 5.1 saveRun — expectedVersion>0 CAS UPDATE（version 不匹配→VERSION_CONFLICT）; expectedVersion=0 deferred（产品路径不用）
- [x] 5.2 loadRun scope isolation — 正确 scope 返回 record，错误 tenantId/subjectId 返回 undefined
- [x] 5.3 claimRun — UPDATED/VERSION_CONFLICT/NOT_FOUND 三种状态（依赖 1.x 实现）
- [x] 5.4 listRecoverableRuns — 状态过滤 + limit（依赖 2.x 实现）
- [x] 5.5 commitTerminal — COMMITTED/ALREADY_COMMITTED/VERSION_CONFLICT/NOT_FOUND 四种状态
- [x] 5.6 验证：`npm run build` + `npm test` 通过

## 6. RunTimelineEventStoreGateway contract tests

- [x] 6.1 appendEvent idempotency — 新 idempotencyKey INSERT，重复 idempotencyKey 返回已有 record
- [x] 6.2 listEvents — afterSequence=0 全量，afterSequence>0 过滤，optional requestId/runId 过滤
- [x] 6.3 Timeline sequence monotonicity — 跨 run sequence 严格递增不重置
- [x] 6.4 验证：`npm run build` + `npm test` 通过

## 7. 整体验证

- [x] 7.1 `npm run build` 通过
- [x] 7.2 `npm test` 通过
- [x] 7.3 `npm run lint:architecture` 通过（如存在 claimRun/listRecoverableRuns stub 相关 assertion 需同步更新）
- [x] 7.4 确认 claimRun 方法签名与 `agent-contracts` 的 `ClaimRunRequest` 契约一致
- [x] 7.5 确认 listRecoverableRuns 方法签名与 `agent-contracts` 的 `SystemListRecoverableRunsRequest` 契约一致