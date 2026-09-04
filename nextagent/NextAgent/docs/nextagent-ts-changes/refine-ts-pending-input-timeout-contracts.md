# refine-ts-pending-input-timeout-contracts

规划入口：[NextAgent TypeScript 重构与功能增强 Roadmap v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Human Pending Input 契约前置
OpenSpec：[refine-ts-pending-input-timeout-contracts](../../openspec/changes/refine-ts-pending-input-timeout-contracts/)

状态：active（implementation and verification complete，ready for archive review）
类型：frozen gateway contract refinement
主要 owner：`agent-contracts/gateway` 的 `PendingInputStoreGateway`
协作模块：`agent-platform-gateway-local`、`agent-runtime`
认领人：已认领（当前会话）
依赖：stable `ts-core-contracts`、`human-pending-input-timeout`、现有 pending resolve/terminal commit idempotency

目标：

- 用唯一 Agent-scoped unresolved timeout fact查询替换全局 `listDuePendingInputs`。
- 同时发现 future/due `PENDING` 与 `TIMED_OUT + terminal not committed` durable facts。
- 保持 gateway 只查询 durable facts，不推进 pending lifecycle。
- 为后续 deadline-driven timeout reconciliation提供 bounded、stable、fair 的 invocation-local keyset pagination。

契约输入：

- 新增 `PendingInputTimeoutFactCursor` 和 `AgentListUnresolvedPendingInputTimeoutFactsRequest`。
- `PendingInputStoreGateway.listUnresolvedPendingInputTimeoutFacts(...)` 只接受可信 `agentId`、`1..1000` limit 与可选 keyset cursor，不接受`now`或due decision。
- 返回值继续是完整 `PendingInputRecord`；不同 Owner Scope 可出现在同一 Agent scan 中，但每条 record 保留自己的 owner coordinates。
- 删除旧 request/method，不保留 alias、parallel adapter 或 client-facing query。

实现约束：

- SQLite 查询必须以 `agent_id` 为首要过滤条件，并使用 adapter-private indexed storage。
- `TIMED_OUT` incomplete 通过现有 RequestRun terminal commit fact判断，不新增 observation 表、Record 字段或状态。
- keyset cursor 只存在于单次 runtime pass；不得持久化、进入 Web/stream/activity 或成为 feed revision。
- contract、adapter、runtime consumer 与全部 test double 必须原子迁移。

验收要点：

- Contract tests覆盖新 shape 与旧 symbol移除。
- Local gateway tests覆盖 Agent隔离、跨Owner保留、future/due `PENDING`、incomplete `TIMED_OUT`、已提交排除、稳定排序、cursor和非法limit。
- Architecture tests实际阻止channel、frontend、core、capability和model消费该方法。
- `openspec validate refine-ts-pending-input-timeout-contracts --strict`、root contract/architecture gates与语义审查通过。

并行边界：

- 本 change 必须先完成，`fix-ts-pending-input-timeout-lifecycle` 才能开始 runtime worker实现。
- 本 change 不启动 timer/reconciliation，不修改stream、activity或frontend。
- 与其他 pending producer change 可并行，但对 `agent-contracts/gateway`、SQLite pending query和相关 test double存在文件冲突，必须协调写入。
