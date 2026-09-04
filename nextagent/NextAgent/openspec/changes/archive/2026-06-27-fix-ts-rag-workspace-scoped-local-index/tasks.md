## 1. Workspace 范围的本地 RAG 检索

- [x] 1.1 从本地 RAG 检索拒绝条件中移除 Agent id/version。
  来源：`Local retrieval provider consumes governed data`。
  验证：`npm.cmd test -- packages/agent-platform-gateway-local/tests/local-rag-knowledge-governance.test.ts packages/agent-capability/tests/rag-capability.test.ts`。

- [x] 1.2 为同 owner 跨 Agent 检索新增回归覆盖。
  来源：`Local retrieval provider consumes governed data`。
  验证：`npm.cmd test -- packages/agent-platform-gateway-local/tests/local-rag-knowledge-governance.test.ts packages/agent-capability/tests/rag-capability.test.ts`。

- [x] 1.3 保留 owner/workspace 不匹配拒绝覆盖。
  来源：`Local retrieval provider consumes governed data`。
  验证：`npm.cmd test -- packages/agent-platform-gateway-local/tests/local-rag-knowledge-governance.test.ts packages/agent-capability/tests/rag-capability.test.ts`。

## 2. 验证

- [x] 2.1 运行 OpenSpec lint。
  验证：`npm run lint:openspec`。
