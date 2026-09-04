# audit-event-contract Specification

## Purpose
TBD - created by archiving change add-agent-id-to-audit-event. Update Purpose after archive.
## Requirements
### Requirement: AuditEvent carries trusted Agent Scope when a run is available

`AuditEvent` SHALL 包含可选的 `agentId` 字段，用于表达可信 Agent Scope。run-bound audit event MUST 从已固化的 `RequestRun.agentId` 取得该字段，不得从客户端请求体、未经认证 metadata、模型输出、capability 参数、默认 Agent 或全局配置推断。

#### Scenario: Runtime lifecycle audit carries agentId
- **WHEN** runtime acceptance 或 terminal path 为已有 `RequestRun` 构造 `AuditEvent`
- **THEN** event MUST 包含 `agentId: run.agentId`

#### Scenario: Capability audit carries agentId
- **WHEN** capability boundary 为已有 `RequestRun` 构造 `AuditEvent`
- **THEN** event MUST 包含 `agentId: run.agentId`

#### Scenario: Non-run audit omits missing Agent Scope
- **WHEN** 未来非 run 上下文构造 `AuditEvent` 且没有可信 Agent Scope
- **THEN** event MUST 省略 `agentId`
- **AND** MUST NOT 使用默认 Agent、全局配置或伪值补齐

#### Scenario: Untrusted input cannot override Agent Scope
- **WHEN** 客户端请求体、未经认证 metadata、模型输出或 capability 参数包含 Agent 标识
- **THEN** audit event 的 `agentId` MUST NOT 从这些值读取或覆盖

### Requirement: Agent Scope contract change does not introduce durable audit persistence

本 change SHALL 只修复 audit envelope。durable audit sink、gateway port、gateway Record、SQLite table、查询 API 和 retention policy MUST 由后续独立 OpenSpec change 定义。

#### Scenario: Existing audit writer behavior remains unchanged
- **WHEN** 本 change 完成实现
- **THEN** 已有 `AuditEventWriter` 继续消费 audit envelope
- **AND** 本 change MUST NOT 隐式新增 durable audit store 或查询路径

