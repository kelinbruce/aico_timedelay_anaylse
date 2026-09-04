## 设计（Design）

本地 RAG 临时索引在 app 启动时基于可信 workspace 文件策略构建。它不是 Agent 私有的持久索引。因此检索授权应由定义索引语料的 owner scope 和 workspace knowledge scope 决定，而不是由调用方 Agent id/version 决定。

`agentId` 和 `agentVersion` 仍是 `RagRetrievalRequest` 的一部分，用于调用方上下文、日志、诊断和未来的 provider 实现。本地 fallback provider 不再把这些字段用作硬拒绝条件。

本地 provider 仍会在查询前拒绝以下情形：

- `tenantId` 与可信 owner scope 不一致。
- `subjectId` 与可信 owner scope 不一致。
- `knowledgeScope.scopeKind` 不是 `AGENT_WORKSPACE`。
- `knowledgeScope.logicalRoot` 不是 `workspace`。

Tool 输入、用户请求体、模型输出和客户端 metadata 仍然不能覆盖 workspace root、provider 选择、SQLite 位置、FTS 表达式或 provider 私有的索引权威。

## 验证（Verification）

- 本地 RAG 治理测试验证同一 owner/workspace scope 下的另一个 Agent 可以检索 chunk。
- 本地 RAG 治理测试验证 tenant/subject 不匹配时仍返回 `SCOPE_MISMATCH`。
