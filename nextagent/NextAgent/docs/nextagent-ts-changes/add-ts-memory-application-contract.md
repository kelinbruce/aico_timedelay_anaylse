# add-ts-memory-application-contract

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：长期记忆
优先级：P1

状态：active
类型：契约与实施 change
主要 owner：`agent-memory`
依赖：`establish-ts-core-contracts`、`establish-ts-backend-architecture`、`add-ts-long-memory-manage`、既有长期记忆 Gateway contracts

目标：
- 在 `agent-contracts/channel` 定义唯一 `LongTermMemoryManagementPort`，由 `agent-memory` application service 实现并一一委托既有 Store、Retriever 和 Sharing Gateway ports。
- 将长期记忆 Web 管理调用固定为 `agent-channel-web -> agent-contracts/channel -> agent-memory -> agent-contracts/gateway`，`agent-app` 仅负责 composition/wiring。
- 分离 management command/query/view/result 与 Gateway Record/Request/Query/Result，并保持可信 Owner Scope、Agent Scope、取消和安全错误边界。

规格输入：
- Management port 精确包含 save、list、manual save、get、delete、mutate、search、detail、publish、unpublish、list published 和 copy published 12 个 operation。
- Management scope 使用 channel/auth boundary 提供的完整 `IdentityContext`，并由 Agent composition 独立提供 `agentId`；客户端不得覆盖。
- Channel 只负责 HTTP schema、可信 scope 注入、取消连接和 Web DTO projection，不直接消费 Gateway contract。
- `agent-memory` 每个 operation 只调用一个对应 Gateway method，不改变 CAS、幂等、检索 telemetry、sharing transaction 或生命周期算法。

契约输入：
- 公开管理契约放入既有 `@nextagent/agent-contracts/channel`，不新增 `agent-contracts/memory` subpath。
- Management DTO 不继承、别名或 re-export Gateway DTO、Record、write options、port 或 bindings。
- 现有 REST 的 `tenantId`、`userId` 和 `agentId` 由 Channel 从本次可信 `IdentityContext` 和 Agent Scope 投影；`userId` 映射自 `identityContext.subjectId`，`displayName` 不进入 Gateway 或 REST DTO。
- 所有 12 个 management method 接收可选 `AbortSignal`；当前 Gateway contract 不增加 signal，只保证调用前取消。

实现约束：
- `agent-memory` 公开 `createLongTermMemoryManagementService({ store, retriever, sharing })`，负责独立 DTO 映射、单次委托和固定 safe unavailable error。
- `agent-channel-web` 只能依赖 channel management contract，不得导入长期记忆 Gateway 类型。
- `agent-app` 只选择 bindings、调用 factory 并把返回 port 注入 Channel，不做 management DTO mapping、Record projection 或业务校验。
- dependency-cruiser 和 architecture tests 允许 `agent-memory -> agent-contracts/channel`，同时阻止 `agent-channel-web -> gateway` 和 contract-to-implementation 依赖。

非目标：
- 不增加 count、batch、transition、adjust、access 或兼容别名。
- 不修改长期记忆 Gateway method、SQLite schema、REMOTE adapter 或前端 REST contract。
- 不改变 extraction、dreaming、aging、revival、sharing 或 retrieval 算法。

验收要点：
- Contract tests 固定 12-method surface、独立 scope 和 Gateway 类型防泄漏。
- Service tests 覆盖 12 个 operation 的单次委托、DTO 映射、SafeError、CAS/write options 和 pre-abort。
- Route tests 覆盖可信 scope、authority 字段拒绝、取消、安全错误和既有 REST projection。
- Composition 与 architecture tests 证明唯一调用链和 `agent-app` 仅 wiring。
- `openspec validate --all --strict`、build、unit、contract、architecture 和 push 前模型语义 review 全部通过。

并行边界：
- `agent-contracts/channel` 拥有 management public contract；`agent-memory` 拥有 application service 和 mapper。
- Gateway contract/adapter 继续拥有 persistence 与 remote service 语义，不感知 Web DTO。
- `agent-channel-web` 拥有 transport/projection；`agent-app` 拥有依赖选择与 wiring。
- 任何偏离上述唯一调用链或新增公开 contract namespace 的方案必须重新完成冻结契约群确认。
