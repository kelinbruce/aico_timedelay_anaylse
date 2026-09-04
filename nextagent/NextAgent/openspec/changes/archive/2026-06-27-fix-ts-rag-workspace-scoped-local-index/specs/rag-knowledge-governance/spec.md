## MODIFIED Requirements

### Requirement: 本地检索 provider 消费受治理数据

在本地部署中，`agent-platform-gateway-local` SHALL 提供本地 `RagRetrievalGateway` fallback provider。该 provider SHALL 只读取本地 RAG 知识治理产生的临时检索数据，把私有 FTS5 row 映射为 provider 中立的 chunk 结果，并在查询前消费治理 ready/degraded/unavailable 状态。它 MUST NOT 通过 public gateway result 暴露 FTS5 表名、SQLite row、host path、workspace root 或 raw FTS5 表达式。

本地检索 provider SHALL 把本地 RAG 临时索引视为当前可信 owner 的 workspace 级共享索引。它 MUST 在查询前校验 trusted owner scope、knowledge scope kind 和 logical root。它 MUST NOT 仅因 `agentId` 或 `agentVersion` 与构建或组装本地 RAG 治理所用的 Agent 不同而拒绝检索。`agentId` 和 `agentVersion` MAY 保留在请求中用于 caller context、诊断或 provider 实现，但本地 fallback 检索 MUST NOT 把它们用作 workspace 索引隔离边界。

#### Scenario: 本地 provider 返回受治理 chunk
- **GIVEN** 本地启动治理已完成并标记为 ready
- **AND** 本地临时检索数据中存在一个匹配查询的 chunk
- **WHEN** `RagRetrievalGateway.retrieve()` 在本地 provider 上执行
- **THEN** provider SHALL 只查询受治理的临时数据
- **AND** 返回带安全 source ref、有界内容和可选 score 的 provider 中立 chunk
- **AND** MUST NOT 返回私有 FTS5 row 字段或 host path。

#### Scenario: 同 owner 的 Agent 检索共享 workspace RAG
- **GIVEN** 本地 RAG 治理已为可信 owner 和 workspace scope 构建好 ready 临时索引
- **AND** 一个请求使用相同 tenant、相同 subject、`AGENT_WORKSPACE` 和 logical root `workspace`
- **WHEN** 检索由与默认组装 Agent 不同的 Agent id/version 发起
- **THEN** 本地 provider MUST 查询受治理的临时数据
- **AND** MUST NOT 以 `SCOPE_MISMATCH` 失败

#### Scenario: Owner scope 不匹配被拒绝
- **GIVEN** 本地 RAG 治理已构建好 ready 临时索引
- **WHEN** 检索以不同的 tenant 或 subject 发起
- **THEN** 本地 provider MUST 在查询前拒绝该请求
- **AND** 诊断 reason MUST 为 `SCOPE_MISMATCH`

#### Scenario: 治理不可用阻断本地检索
- **GIVEN** 本地启动治理为 unavailable 或 degraded 且没有可安全查询的数据
- **WHEN** `RagRetrievalGateway.retrieve()` 在本地 provider 上执行
- **THEN** provider SHALL 返回带低基数 reason 的显式 unavailable 或 degraded 状态
- **AND** MUST NOT 查询缺失或无效的 FTS5 数据
- **AND** MUST NOT 报告一次空的成功检索。
