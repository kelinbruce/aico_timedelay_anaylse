# add-agent-id-to-audit-event

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Observability 和 Audit

状态：active
类型：contract refinement change
主要 owner：`agent-contracts/observability`
依赖：`establish-ts-core-contracts`（已归档）

目标：
- 在 `agent-contracts/observability` 的 `AuditEvent` 增加可选 `agentId` 字段。
- 要求已有 run-bound runtime lifecycle audit 从 `RequestRun.agentId` 传递 `agentId`。
- 要求已有 run-bound capability audit 从 `RequestRun.agentId` 传递 `agentId`。
- 补齐 contract、runtime 和 capability audit envelope 验证。

规格输入：
- `AuditEvent.agentId` 保持 optional，兼容未来非 run 上下文的 audit event。
- 当前已有 run-bound 主路径必须显式传递可信 `run.agentId`。
- `agentId` 不得从客户端请求体、未经认证 metadata、模型输出或 capability 参数中读取。
- 不改变 audit event 的业务语义、事件名、safe summary 或 attributes 安全边界。
- durable audit sink 仍是后续独立 change，不在本次修复中隐式引入。

契约输入：
- `agent-contracts/observability` 的 `AuditEvent` 新增可选 `agentId?: AgentId`。
- `agent-common` 的 `AgentId` branded 类型已在核心契约中定义。

实现约束：
- 不新增 durable audit sink、gateway port、gateway Record、SQLite table、查询 API 或 retention policy。
- 不修改已归档 baseline；归档本 change 时再提升长期基线。

非目标：
- 不新增 audit event 类型或 audit event 字段（除 `agentId` 外）。
- 不新增 `AuditEventWriter` 接口变更。
- 不实现 audit 查询、检索或导出 API。

验收要点：
- contract test：`AuditEvent` 带 `agentId` 的 schema 验证通过。
- contract test：`AuditEvent` 不带 `agentId` 时仍合法（optional）。
- contract test：run-bound audit event 必须携带非空 `agentId`。
- architecture test：`AuditEvent.agentId` 类型为 `AgentId`（branded string）。
- integration test：runtime lifecycle audit call site 从 `RequestRun.agentId` 传递。
- integration test：capability audit call site 从 `RequestRun.agentId` 传递。

并行边界：
- 不修改 `AuditEventWriter` 接口。
- 不修改其他 `AuditEvent` 字段。
- 不新增 observability subpath export。
