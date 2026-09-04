# add-ts-local-run-timeline-store

## 背景与问题

`agent-platform-gateway-local` 内的 `RequestRunStoreGateway`（saveRun/loadRun/commitTerminal）和 `RunTimelineEventStoreGateway`（appendEvent/listEvents）已有完整 SQLite 实现，覆盖了 run 创建→状态更新→terminal commit→timeline event 追加→查询的主链路。但以下能力存在缺口：

1. **`claimRun` 是 no-op stub** — 方法签名忽略所有参数，始终返回 `{ status: "VERSION_CONFLICT" }`。本地单进程模式下无需分布式 locking，但 stub 不符合 contract 要求的 `ClaimRunRequest` 参数和 `VERSION_CONFLICT/NOT_FOUND/UPDATED` 三种返回状态。
2. **`listRecoverableRuns` 是 no-op stub** — 始终返回 `[]`，忽略所有参数。`SystemListRecoverableRunsRequest` 合约只有 `now` + `limit`（无 owner scope），本地模式需要支持重启后发现未完成 run。
3. **terminal commit 幂等/恢复语义缺少专项测试** — `commitTerminal` 有完整的实现，但缺少针对幂等重试（ALREADY_COMMITTED）、事务回滚后重试安全、崩溃恢复场景的 contract/architecture tests。
4. **`loadSessionLaneSnapshot` 不在当前合约中** — 该方法尚未添加到 `agent-contracts` 的 `RequestRunStoreGateway` 接口，不应在本 change 中实现，应归入 `add-ts-session-lane-scheduling`。

本 change 不再作为"本地 store 初始实现"——实际实现已存在且工作。本 change 只补实 `claimRun` 和 `listRecoverableRuns`，并补齐 terminal commit 幂等/恢复语义测试。

## 变更范围

- 补实 `claimRun(request: ClaimRunRequest)` — 本地单进程模式下无需分布式 lock，实现为 CAS UPDATE（SET locked_by + lock_expires_at WHERE version=expectedVersion），返回 UPDATED/VERSION_CONFLICT/NOT_FOUND
- 补实 `listRecoverableRuns(request: SystemListRecoverableRunsRequest)` — SELECT by status IN + terminal_commit_state IN + (now 条件) 过滤，返回未完成 run 列表
- 补齐 terminal commit 幂等测试 — 验证 ALREADY_COMMITTED 幂等返回、事务回滚后相同 idempotencyKey 重试安全
- 补齐 terminal commit 恢复语义测试 — 验证崩溃恢复场景下 commitTerminal 的幂等保证和 run state 一致性
- 补齐 RequestRunStoreGateway 和 RunTimelineEventStoreGateway contract tests

**不在范围**：
- 已实现的 saveRun/loadRun/commitTerminal/appendEvent/listEvents — 不重新实现，只追认
- `loadSessionLaneSnapshot` — 尚未进入 `agent-contracts`，归入 `add-ts-session-lane-scheduling`
- Session/SessionMessage → `add-ts-local-session-store`
- Checkpoint → `add-ts-local-checkpoint-store`
- Artifact → `add-ts-local-artifact-store`
- 恢复决策逻辑 → `add-ts-local-runtime-recovery`
- 新增或修改核心契约

## Capability 影响

| 类型 | Capability | 说明 |
|------|-----------|------|
| 补实 | `local-run-timeline-store` | claimRun 和 listRecoverableRuns 从 stub 补为真实实现；contract tests 补齐 |

## 影响范围

- `agent-platform-gateway-local`：`SqliteGatewayStores.claimRun` 和 `listRecoverableRuns` 从 no-op 补为真实 SQLite 实现
- `agent-runtime`：恢复流程可通过 `listRecoverableRuns` 发现未完成 run
- 测试：新增 contract tests 和 terminal commit 幂等/恢复 tests

## 归档前基线提升计划

核心契约 `RequestRunStoreGateway` 和 `RunTimelineEventStoreGateway` 已在 `establish-ts-core-contracts` 中完成定义，本 change 归档时无需向 `openspec/designs/contracts/` 新增内容。