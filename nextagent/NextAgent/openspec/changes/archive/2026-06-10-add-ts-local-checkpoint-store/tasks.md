# add-ts-local-checkpoint-store — 任务

## 1. CheckpointRecord contract 补齐 agentId

- [x] 1.1 `agent-contracts/gateway` 的 `CheckpointRecord` 增加 `readonly agentId: AgentId` 字段
- [x] 1.2 `agent-contracts/runtime` 的 `CheckpointPayload` 增加 `readonly agentId: AgentId` 字段
- [x] 1.3 `saveRuntimeCheckpoint` 调用方从 `run.agentId` 传入
- [x] 1.4 验证：`npm run build` + `npm test` 通过

## 2. Schema 归一化

- [x] 2.1 `checkpoints` 表 DDL 改为全部独立列（15 列），删除 `json` 列
- [x] 2.2 PK 改为 `(tenant_id, subject_id, agent_id, checkpoint_id)`
- [x] 2.3 `idx_checkpoints_idempotency` 增加 `agent_id` 维度
- [x] 2.4 验证：`npm run build` + `npm test` 通过

## 3. 读/写路径改造

- [x] 3.1 `saveCheckpoint` — INSERT 改为 15 列直绑，无 JSON.stringify
- [x] 3.2 `loadCheckpoint` — SELECT 改为列名，toCheckpointRecord 组装
- [x] 3.3 `getCheckpointByIdempotencyKey` — SELECT 改为列名，toCheckpointRecord 组装
- [x] 3.4 新增 `CheckpointRow` 接口 + `toCheckpointRecord` 函数
- [x] 3.5 验证：`npm run build` + `npm test` 通过

## 4. active_context_items 归一化（在 session-store）

- [x] 4.1 `active_context_items` 表 DDL 删除 `json` 列（已有 6 独立列完整覆盖）
- [x] 4.2 `insertActiveContextItemSync` — INSERT 去掉 `json` 列
- [x] 4.3 `loadActiveContextSync` — `SELECT json FROM` 改为 `SELECT ordinal, message_id FROM` + 直接组装对象
- [x] 4.4 验证：`npm run build` + `npm test` 通过

## 5. CheckpointStoreGateway contract tests

- [x] 5.1 saveCheckpoint 幂等 — 新 idempotencyKey INSERT，重复 idempotencyKey 返回已有 record（已有 runtime-foundation test 覆盖）
- [x] 5.2 loadCheckpoint latest — 多 checkpoint 场景下返回 savedAt 最大的
- [x] 5.3 loadCheckpoint scope 隔离 — 错误 tenantId/subjectId/agentId 返回 undefined
- [x] 5.4 验证：`npm run build` + `npm test` 通过

## 6. Architecture test 更新

- [x] 6.1 `workspace.test.ts` — 验证 `checkpoints` 表无 `json` 列（验证旧 PK 格式和 json 列不存在）
- [x] 6.2 `workspace.test.ts` — 验证 `checkpoints` 表含 `agent_id` 列
- [x] 6.3 `workspace.test.ts` — 验证 `active_context_items` 表无 `json` 列
- [x] 6.4 验证：`npm run build` + `npm test` 通过

## 7. 整体验证

- [x] 7.1 `npm run build` 通过
- [x] 7.2 `npm test` 通过
- [x] 7.3 `npm run lint:architecture` 通过
- [x] 7.4 确认 `CheckpointRecord` 合约与实现一致