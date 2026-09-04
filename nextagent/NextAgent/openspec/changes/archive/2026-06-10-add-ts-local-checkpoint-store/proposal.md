# add-ts-local-checkpoint-store

## 背景与问题

`establish-ts-core-contracts` 已冻结 `CheckpointStoreGateway` 接口（`saveCheckpoint` / `loadCheckpoint`），`agent-platform-gateway-local` 的 `SqliteGatewayStores` 已有完整实现：`saveCheckpoint` 含幂等检查、`loadCheckpoint` 按 scope + session/request/run 返回最新 checkpoint。`checkpoints` 表 DDL 已存在。

但以下能力存在缺口：

1. **`checkpoints` 表使用 `json TEXT` 列存储完整 record** — `requestContextId`、`runVersion`、`triggerReason`、`lastSequence`、`activeContextVersion`、`flowVariables` 只在 json 内，无独立列。需归一化为独立列。
2. **`checkpoints` 表缺少 `agent_id` 列** — 当前 PK 为 `(tenant_id, subject_id, checkpoint_id)`，不符合 AGENTS.md 要求"所有持久化 record 显式携带 agentId"。执行 checkpoint 的 agentId 未持久化。
3. **缺少 contract tests** — `saveCheckpoint`/`loadCheckpoint` 无直接 contract test，只有 runtime 间接覆盖。
4. **`loadCheckpoint` 无调用方** — 恢复路径尚未实现（属于 `add-ts-local-runtime-recovery`），不在本 change 范围。

本 change 追认已有实现、归一化 schema、补齐 agent scope 和 contract tests。

## 变更范围

- 追认已有 `saveCheckpoint` / `loadCheckpoint` 完整实现
- `checkpoints` 表归一化：删除 `json TEXT NOT NULL`，将 `request_context_id`、`run_version`、`trigger_reason`、`last_sequence`、`active_context_version`、`flow_variables` 提取为独立列
- 新增 `agent_id TEXT NOT NULL` 列，读/写路径强制 agent scope
- 补齐 `CheckpointStoreGateway` contract tests：幂等保存、scope 隔离、latest checkpoint 查询
- 补齐 architecture test：验证 schema 无 json 列

**不在范围**：
- 不新增或修改核心契约
- 不实现 checkpoint 恢复逻辑 → `add-ts-local-runtime-recovery`
- Session/SessionMessage → `add-ts-local-session-store`
- RequestRun/Timeline → `add-ts-local-run-timeline-store`
- 过期/清理策略
- schema migration 框架

## Capability 影响

| 类型 | Capability | 说明 |
|------|-----------|------|
| 补实 | `local-checkpoint-store` | 归一化 schema + agent scope + contract tests |

## 影响范围

- `agent-platform-gateway-local`：`SqliteGatewayStores` 内 checkpoint 读写路径改为独立列绑定
- `agent-runtime`：`saveRuntimeCheckpoint` 调用方需传入 `agentId`
- 测试：新增 contract tests + architecture test

## 归档前基线提升计划

核心契约 `CheckpointStoreGateway` 已在 `establish-ts-core-contracts` 中完成定义，本 change 归档时无需向 `openspec/designs/contracts/` 新增内容。