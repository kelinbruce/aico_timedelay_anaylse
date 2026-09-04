# add-ts-long-term-memory-remote-adapter

索引：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory
优先级：P2（正式版，不在 P0/P1 范畴）

状态：active
类型：实施 change
主要 owner：`agent-platform-gateway-remote`
依赖：`add-ts-memory-core`、`add-ts-gateway-configuration`

目标：

- 为固定远端系统 AgentMemory 提供 `LongTermMemoryStoreGateway` 和 `LongTermMemoryRetrieverGateway` 的远端实现。
- 不修改 TS memory contracts；远端服务按 TS 的 L1/L2、lifecycle、confidence、access、物理删除、scope 和 `LTM_*` error 语义补齐能力。

规格输入：

- `MemoryService` 继续只消费两个既有 gateway ports，不感知远端 path 和 DTO。
- 远端适配覆盖 upsert save、L1 get/list/search、L2 detail、普通 DELETE 默认物理删除、state transition、confidence adjustment 和 accessed-at update。
- `design.md` 固定 AgentMemory base path、完整 request/query/response DTO、record/page/mutation/error envelope、字段映射和 HTTP/error mapping。
- AgentMemory wire 字段使用 `labels`，adapter 映射为 TS `tags`；不要求远端响应提供 `tags`。
- `idempotencyKey` 只用于无 `entryId` 的 POST create 重试去重；TS request 携带时 adapter 必须传递给 AgentMemory；指定 `memoryId` 的 PUT upsert 用资源 ID 表达幂等，lifecycle mutation 使用 `expectedVersion` 做 CAS。
- `transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence` 和 `markLongTermMemoryAccessed` 共用字段级 `PUT /rest/naie/memory/v2/agent/long-term-mem/{memoryId}`。
- 共享 PUT 不使用 operation discriminator；三个 gateway method 使用独立 mapper，只提交各自允许字段。
- Search/detail 的 recall/access 统计由远端单次 server-side operation 原子完成。
- `deleteLongTermMemory` 调用普通 `DELETE /rest/naie/memory/v2/agent/long-term-mem/{memoryId}`；AgentMemory 默认物理删除，不增加 `/hard` 或 hard 参数，archive、forget 或 soft delete 不能映射为成功。
- 所有请求保持 trusted `tenantId`、`subjectId`、`agentId`；记忆实例或命名空间由 adapter 配置和 trusted scope 派生。

契约输入：

- `add-ts-memory-core` 的 `LongTermMemoryRecord`、Request/Query、`MemoryState`、L1/L2 和 `LTM_*` vocabulary。
- `LongTermMemoryStoreGateway` 和 `LongTermMemoryRetrieverGateway`。
- `VersionedUpdateResult` 和 expected version CAS。

实现约束：

- 主要写入模块是 `agent-platform-gateway-remote`。
- `agent-app` 只负责 remote profile 配置和 gateway composition。
- adapter-private HTTP client 固定命名为 `AgentMemoryClient`；`AgentMemory*` DTO、schema、path 和 service error 不得泄漏到上层。
- `saveLongTermMemory` partial update 不得绕过 lifecycle mutation。
- `saveLongTermMemory` 保持 upsert：无 `entryId` 创建并生成 ID；有 `entryId` 时存在则更新、不存在则以该 ID 创建。
- lifecycle mapper 只提交 state/reason；confidence mapper 只提交 `delta`，由远端按当前 confidence 计算并 clamp；access mapper 只提交访问时间且不得覆盖 access count。
- Detail 不得隐式恢复 archived entry。
- 远端不可用时返回既有 `LTM_STORAGE_UNAVAILABLE`，不写 local fallback、不新增 safe error code。

非目标：

- 不修改 `add-ts-memory-core` 或 `agent-contracts`。
- 不定义 memory tools、extraction、aging policy、sharing、publishing、maintenance UI 或 user-facing API。
- 不修改工作记忆、terminal commit、history、active context 或 recovery adapter。
- 不定义远端物理表和索引实现。

验收要点：

- 每个 gateway method 有独立 mapping fixture 和 normal/boundary/failure tests。
- AgentMemory 必需能力差异清单逐项通过；任一必需 endpoint、`labels` 字段、CAS result、原子副作用或普通 DELETE 物理删除语义缺失时 profile 不可 ready。
- 三个 mutation 共用 PUT，但 mapper 字段子集和禁止字段可验证。
- L1/L2、hybrid score、search/detail side effects 和默认 DELETE 物理删除可验证。
- 跨 owner/agent scope 不泄漏。
- CAS、既有 safe error、跨 scope audit 和 DTO 隔离通过 contract/architecture tests。

并行边界：

- `agent-platform-gateway-remote` 拥有 wire profile 和 adapter implementation。
- `agent-memory` 拥有 `MemoryService` 业务门禁，不拥有 HTTP client。
- 远端服务拥有 server-side atomicity、索引、统计和普通 DELETE 的物理删除实现。
- 工作记忆 adapter change 不依赖或承载本 change。

后续维护：

- 归档时将稳定行为提升到长期记忆远端 adapter stable spec 和 remote gateway/module designs。
- 如果需要修改 TS memory contracts，必须单独提出 contract refinement change。
