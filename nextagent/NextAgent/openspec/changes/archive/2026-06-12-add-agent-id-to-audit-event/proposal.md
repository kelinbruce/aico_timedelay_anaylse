## 背景与问题（Why）

`AuditEvent` 已由 archived core-contract baseline 冻结，但当前契约只有 `tenantId`、`subjectId` 和可选的 `requestRunId`，缺少 Agent Scope 标识。

现有 runtime lifecycle 和 capability audit call site 都已持有可信的 `RequestRun.agentId`。如果审计事件不携带该字段，后续 audit sink 无法在不重新选择默认 Agent 或全局配置的前提下建立 Agent Scope 隔离。

## 变更范围（What Changes）

- 在 `agent-contracts/observability` 的 `AuditEvent` 增加可选 `agentId`
- 要求已有 run-bound runtime lifecycle audit 从 `RequestRun.agentId` 传递 `agentId`
- 要求已有 run-bound capability audit 从 `RequestRun.agentId` 传递 `agentId`
- 补齐 contract、runtime 和 capability audit envelope 验证

## 明确不变更（What We Are NOT Changing）

- 不新增 durable audit sink、gateway port、gateway Record、SQLite table、查询 API 或 retention policy
- 不把 `agentId` 从客户端请求体、未经认证 metadata、模型输出或 capability 参数中读取
- 不改变 audit event 的业务语义、事件名、safe summary 或 attributes 安全边界
- 不修改已归档 baseline；归档本 change 时再提升长期基线

## Impact

- `AuditEvent.agentId` 保持 optional，兼容未来非 run 上下文的 audit event
- 当前已有 run-bound 主路径必须显式传递可信 `run.agentId`
- durable audit sink 仍是后续独立 change，不在本次修复中隐式引入

## 归档前基线提升计划（Baseline Promotion Plan）

- 更新 `openspec/specs/ts-core-contracts/spec.md` 的 audit event contract
