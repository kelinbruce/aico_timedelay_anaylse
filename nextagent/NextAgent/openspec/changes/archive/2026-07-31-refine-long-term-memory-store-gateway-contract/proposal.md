## 背景与问题（Why）

外部长时记忆服务已经通过 `long-term-memroy-api.yaml` 定义 V2 契约，包含 6 个 Store operation、2 个 Retriever operation 和 4 个 Sharing operation。当前 NextAgent `LongTermMemoryStoreGateway` 仍使用早期内部模型：字段名为 `longTermMemoryId/category/tags/sourceTrace`，`content` 为 TypeScript union，并额外暴露 YAML 中不存在的 `countLongTermMemory`、`batchLongTermMemory` 以及自定义 discriminated mutation union。`LongTermMemoryGatewayBindings` 也没有 Sharing Gateway。

这会使 LOCAL provider、未来 REMOTE adapter 和算法调用方分别维护不同契约，无法逐项对照外部 API，也容易在 `userId`、版本控制、共享跨 owner 访问等安全边界上产生不一致。

本变更以修正后的 `C:\Users\xubaojian\Downloads\long-term-memroy-api.yaml` 为接口事实来源。Gateway public contract 必须与其 operation、字段名、必填性和业务数据响应保持一致，只保留 NextAgent 架构强制要求的边界映射。

## 变更范围（What Changes）

- `LongTermMemoryStoreGateway` 对齐 YAML 的 6 个 operation：`saveLongTermMemory`、`listLongTermMemory`、`manualSaveLongTermMemory`、`getLongTermMemory`、`deleteLongTermMemory`、`mutateLongTermMemory`。
- `LongTermMemoryRetrieverGateway` 对齐 YAML 的 2 个 operation：`searchLongTermMemory`、`getLongTermMemoryDetail`。
- 新增 `LongTermMemorySharingGateway`，对齐 YAML 的 4 个 operation：`publishLongTermMemory`、`unpublishLongTermMemory`、`listPublishedLongTermMemory`、`copyPublishedMemory`。
- Gateway DTO 使用 YAML 字段：`memoryId`、`memoryType`、`knowledgeSourceType`、`sharingState`、`sourceMemoryId`、`memoryInstance`、`labels`、`content`、`source`、`createTime`、`updateTime` 等；`content` 和 `source` 保持字符串，不再在 Gateway public contract 中定义 category-specific union。
- `mutateLongTermMemory` 使用 YAML 的 flat PATCH shape，并校验一次请求只包含 `targetState/archiveReason`、`delta`、`lastAccessTime`、`isPinned` 四组之一；不再定义 `LongTermMemoryMutation.kind`。
- `LongTermMemoryGatewayBindings` 增加 required `sharing` binding；LOCAL 和 disabled provider 同步实现，调用方及测试替身同步迁移。
- LOCAL persistence 增加 `memoryInstance`、`knowledgeSourceType`、`sharingState`、`sourceMemoryId` 的 durable mapping，并实现 publish/unpublish/list shared/copy 的 scope、幂等和事务语义。
- `countLongTermMemory` 和 `batchLongTermMemory` 不在 YAML 中，本变更从 public Gateway contract 和实现中删除，不提供替代接口或 REMOTE 模拟。

## 强制映射（Framework-Mandated Mappings）

- YAML `userId` 在 Gateway 内部表示为 `OwnerScoped.subjectId`。该值只能来自可信 identity/channel boundary；REMOTE adapter 在 wire boundary 映射回 `userId`。
- YAML `idempotencyKey` 和 `expectedVersion` 属于写控制元数据。Gateway 使用 `VersionedWriteOptions.idempotencyKey/expectedVersion`，不得把它们放进 Request 或 Record；REMOTE adapter 负责合并到 YAML body。
- YAML `RestResponse.data` 在 Gateway port 返回业务数据本身；`LtmError` 映射为框架统一 `SafeError`，不得让 REST envelope 或 raw provider error 穿透 Gateway。
- `listPublishedLongTermMemory` 的 YAML wire query 没有 `userId`，但内部 Gateway request 仍携带可信 `subjectId` 作为调用者身份和授权上下文；REMOTE adapter 不把该字段发送为 wire query。

以上四项是既有 Owner Scope、write metadata 和 safe error 架构约束的必要映射，不构成新的记忆业务模型。

## 不在范围内（Non-Goals）

- 不实现 YAML 未定义的 count 或 batch operation。
- 不在 `agent-platform-gateway-remote` 实现 HTTP client、重试或认证装配；本变更冻结其必须实现的 Gateway contract。
- 不改变 dreaming 的提取、等价判断、冲突判断、confidence corroboration 或 aging 策略，只迁移其 Gateway DTO 和序列化边界。
- 不新增共享管理 Web API、UI 或模型工具。
- 不让 gateway-local 决定算法 promotion、decay、revival 或 extraction policy。

## 破坏性变更（Breaking Changes）

- 删除 `LongTermMemoryMutation` discriminated union、`BatchLongTermMemory*`、`CountLongTermMemory*` 和 Store 上对应方法。
- Gateway Record/Request/Query/Result 字段改为 YAML 名称和 shape；所有编译期 caller、provider 和测试替身必须同一次变更迁移。
- `LongTermMemoryGatewayBindings.sharing` 变为 required，所有 composition owner 必须显式绑定 LOCAL、REMOTE 或 disabled implementation。

## Capability 影响（Capabilities）

### 修改的 Capability

- `memory-core`：对齐 Store/Retriever Gateway V2 operation、DTO、返回值、错误和 scope 语义。
- `memory-extraction`：通过字符串 `content/source` 与 flat mutation DTO 调用 core Gateway。
- `memory-aging`：通过 YAML list/get/mutate/delete shape 执行 decay、archive、retention delete 和 revival。

### 新增的 Capability

- `memory-sharing`：发布、撤销发布、浏览共享池和复制共享记忆。

## 影响范围（Impact）

- `packages/agent-common`：增加 YAML 使用的 durable scalar vocabulary。
- `packages/agent-contracts/gateway`：替换长期记忆 DTO/ports/bindings。
- `packages/agent-platform-gateway-local`：更新 SQLite row mapping、schema migration、Store/Retriever 实现并增加 Sharing 实现。
- `packages/agent-memory`：更新 disabled adapter、tools、extraction、aging 和测试替身。
- `packages/agent-app`、`packages/agent-platform-gateway-remote`：更新 Gateway binding composition shape。
- Contract、LOCAL persistence、memory algorithm 和 architecture tests 必须覆盖正向及跨 scope/非法 flat PATCH/共享越权 negative cases。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-core/spec.md`：归并 Store/Retriever V2 行为并删除 count/batch 旧契约。
- `openspec/specs/memory-sharing/spec.md`：新增共享能力稳定规格。
- `openspec/specs/memory-extraction/spec.md`、`openspec/specs/memory-aging/spec.md`：归并调用 shape 变化，不改变算法策略。
- `openspec/designs/architecture/memory-learning-system.md`：归并 YAML 对齐、Owner Scope 映射、共享跨 owner 边界和算法/软件职责。
- `openspec/designs/modules/agent-contracts.md`、`openspec/designs/modules/agent-memory.md`、`openspec/designs/modules/agent-platform-gateway-local.md`：归并模块 contract 和实现 ownership。
- `openspec/designs/spec-to-design-map.md`：增加 `memory-sharing` 及上述设计入口。
- 本变更不产生新的 ADR；它执行现有 Gateway、Owner Scope 和 write metadata 约束。
