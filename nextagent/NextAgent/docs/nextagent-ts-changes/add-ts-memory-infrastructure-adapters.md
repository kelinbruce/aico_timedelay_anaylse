# add-ts-memory-infrastructure-adapters

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory
优先级：P2（正式版，不在 P0/P1 范畴）

状态：active
类型：实施 change
主要 owner：`agent-platform-gateway-remote`
依赖：`establish-ts-core-contracts`、`ship-ts-minimal-agent-kernel`、`add-ts-gateway-configuration`

目标：
- 为远端记忆后端补齐 TS 侧记忆基础设施适配器，使 `agent-platform-gateway-remote` 通过 adapter-private DTO/schema、mapping tests 和 architecture gates 消费远端 memory 后端，同时保持既有 gateway contracts、terminal commit、history、current request 和 recovery 语义不变。

能力组共享输入：

整理状态：已整理为独立 change 输入

规格输入：
- 远端记忆适配器只能实现或装配既有 TS gateway ports，不新增 `WorkingMemoryStore`、`ActionStore` 或 remote-memory-specific public port。
- 远端记忆 wire DTO、wire enum、warning/error code 和 service schema 只允许停留在 `agent-platform-gateway-remote` adapter-private implementation 和测试 fixture。
- 适配器必须覆盖 session、message、history pagination、current request messages、RequestRun、checkpoint、timeline、active context、attachment、blob、artifact、pending input、feedback 和 terminal commit。
- 远端记忆服务调用必须由 `agent-platform-gateway-remote` 内部的 adapter-private `RemoteMemoryClient` 承载；`agent-app` 只通过 remote `GatewayAdapterConfig` 注入 `baseUrl`、credential reference、timeout 和 retry policy，并只向上层暴露既有 gateway ports。
- Terminal commit 必须调用远端 composite boundary 或等价 server-side transaction command，不得由适配器通过多个独立 remote write 模拟。
- Terminal commit 的 active context append 语义只能由既有 `terminalMessage` 派生，不得新增 `TerminalCommitRequest` 字段。
- 历史投影输入只允许进入 `SessionMessageStoreGateway.listMessages` 映射；不得进入 current request、RequestRun、checkpoint、active context、timeline、terminal commit、pending input、attachment/blob/artifact、feedback 或 recovery。
- 所有 remote facts 和 projection input 必须保留 `tenantId`、`subjectId`、`agentId` 隔离语义；scope mismatch 返回 safe not-found/empty，不泄漏对象是否存在。
- Safe error mapping 不得暴露 raw backend exception、SQL、stack、wire DTO、credential、token、prompt、model output、attachment content 或敏感 payload。

契约输入：
- 不修改 `agent-contracts` public port signature、record/query 字段、enum vocabulary 或 public DTO。
- `ActiveContextStoreGateway.loadActiveContext`、`appendItem`、`commitCompaction` 必须分别映射，保留 active context version/CAS conflict 语义。
- Projection item 必须能映射为 existing `SessionMessageRecord`；不能要求新增 TS public record 字段。

实现约束：
- 主要写入模块是 `agent-platform-gateway-remote`。
- `agent-platform-gateway-remote` 必须提供 remote memory adapter bundle factory，装配 `SessionStoreGateway`、`SessionMessageStoreGateway`、`RequestRunStoreGateway`、`RunTimelineEventStoreGateway`、`ActiveContextStoreGateway`、`AttachmentStoreGateway`、`BlobStoreGateway`、`ArtifactGatewayPort`、`CheckpointStoreGateway`、`PendingInputStoreGateway` 和 `FeedbackStoreGateway` 的远端实现。
- 远端实现必须贴合当前 gateway method surface：`ArtifactGatewayPort` 只实现 metadata save/load，`PendingInputStoreGateway` 只实现 create/load/resolve，`RequestRunStoreGateway` 的列表能力只实现 `listRecoverableRuns`；不得把远端服务额外能力扩展为 TS public port。
- 上层 runtime、session、context-engine、core、channel、model、capability 和 `agent-contracts` 不得 import 远端记忆 DTO。
- 当前 change 只定义 TS adapter、contract fixtures、architecture tests 和 characterization tests；不定义远端后端物理表、服务部署、数据搬迁或数据治理流程。

非目标：
- 不实现远端 memory backend 本身。
- 不改变 local SQLite gateway。
- 不把历史投影输入合成为 runtime recovery facts。
- 不新增长期记忆、自学习或 memory lifecycle 产品能力。

验收要点：
- 远端适配器 contract tests 覆盖每个 gateway operation 的 owner/agent scope、idempotency、CAS、pagination、visibility 和 safe error。
- Terminal commit adapter tests 断言 terminal path 只调用 composite boundary。
- History projection tests 覆盖 projection 只进入 `listMessages`，并遵守 hidden/capability-result/cursor filters。
- Recovery negative tests 证明只有 projection input、没有 remote runtime facts 时不恢复 RequestRun。
- Architecture lint 阻止远端记忆 DTO 泄漏。

并行边界：
- `agent-platform-gateway-remote` 拥有 adapter-private DTO/schema 和 mapping。
- Runtime 继续拥有 request lifecycle、terminal commit policy 和 recovery policy。
- Session/context 继续消费既有 gateway contracts，不感知 remote wire shape。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
