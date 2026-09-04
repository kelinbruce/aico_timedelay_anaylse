## MODIFIED Requirements

### Requirement: RAG Tool 使用 gateway 边界

`rag` executor SHALL 只依赖 public `RagRetrievalGateway` contract 和 capability invocation context。它 MUST NOT 导入本地治理实现、SQLite/FTS5 实现、provider 私有 client、provider 私有 wire DTO 或 workspace host path。产品 composition SHALL 注入当前 package/composition 形态下可用的 gateway provider；Tool input MUST NOT 选择或切换该 provider。

对于本地 fallback provider，产品 composition SHALL 把本地 RAG 治理视为可信 owner 的 workspace 级共享索引。Tool input、用户请求体、模型输出和客户端 metadata MUST NOT 选择 provider、切换 workspace 权限、覆盖 owner scope、设置 SQLite/FTS 细节，或把 `agentId`/`agentVersion` 变成 provider 私有索引权限。

#### Scenario: RAG executor 使用注入的 gateway
- **GIVEN** `agent-app` 已组装一个 `RagRetrievalGateway`
- **WHEN** 模型调用 `rag`
- **THEN** executor SHALL 调用被注入的 gateway
- **AND** MUST NOT 实例化 provider 私有本地治理或 provider client。

#### Scenario: Tool input 不能覆盖本地 RAG 权限
- **WHEN** 模型调用 `rag` 时带上试图提供 owner、Agent、workspace、provider、SQLite、FTS 或私有检索权限的输入字段
- **THEN** schema 校验或 app composition MUST 忽略/拒绝这些字段
- **AND** 本地 RAG 检索权限 MUST 仍然只来自可信 owner 和 workspace composition。
