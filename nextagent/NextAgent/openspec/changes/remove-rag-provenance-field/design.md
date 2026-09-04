## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.13 检索知识库` | 移除 `RagRetrievalChunk` gateway contract 中未被消费的 `provenance` 字段 | `rag-tool` | `FN-5.13 检索知识库` |

## `FN-5.13 检索知识库`

### 目标与规范依据

本设计移除 `RagRetrievalChunk` 中从未被展示链路消费的 `provenance` 字段。该字段在本地 retriever 中生成、在 `safeResultPayload` 中透传、在 `local-workflow-rag-retrieval` adapter 中映射，但投影层 `projectRagRetrievalSafeResult` 只输出 `{ source, content }`，`provenance` 从未到达前端。

#### 本 Function 的目标 Requirements

canonical spec：`rag-tool`

- `MODIFIED`：`Result shape is safe and bounded`
- `MODIFIED`：`RAG 检索具有低基数执行诊断`

### 当前实现

1. `agent-contracts/gateway` 的 `RagRetrievalChunk` 接口定义 `provenance?: string`，`ragRetrievalResultSchema` 定义 `provenance` 属性（`additionalProperties: false`）。
2. `agent-capability/builtins/rag/rag-tool.ts` 的 `safeResultPayload` 通过条件展开透传 `provenance`。
3. `agent-capability/builtins/rag/rag-schemas.ts` 的 `ragOutputSchema` 定义 `provenance` 属性。
4. `agent-platform-gateway-local` 的本地 retriever 生成 `provenance: \`${chunk_id};${file_type};L${start_line}-L${end_line}\``。
5. `agent-platform-gateway-local` 的 `local-workflow-rag-retrieval` adapter 从 `RagRetrievalChunk.provenance` 映射到 recommends 项的 `provenance`。
6. `agent-channel-common` 的 `projectRagRetrievalSafeResult` **不输出** `provenance`，只输出 `{ source, content }`。
7. 前端 `readRagRetrievalItems` 使用 `hasExactKeys(['source', 'content'])` 严格校验，`provenance` 不会进入前端。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Result items 不包含 `provenance` | contract 和 schema 定义了 `provenance`，retriever 生成它，payload 透传它 | 从 contract、schema、retriever、payload、adapter 中移除 |
| 诊断不引用 `provenance` | spec 的诊断 "MUST NOT" 列表包含 `provenance` | 从 spec 中移除引用 |
| 测试不依赖 `provenance` | 多个测试使用 `provenance` 作为字段验证或非泄漏断言 | 移除或替换 |

### 修改方案

1. **Contract 层**：从 `RagRetrievalChunk` 接口移除 `provenance?: string`，从 `ragRetrievalResultSchema` 的 results items properties 移除 `provenance`。
2. **能力层**：从 `ragOutputSchema` 的 results items properties 移除 `provenance`，从 `safeResultPayload` 移除 `...(item.provenance === undefined ? {} : { provenance: item.provenance })`。
3. **本地 retriever**：从 `local-rag-knowledge-governance.ts` 的 results 映射中移除 `provenance` 行。
4. **Workflow adapter**：从 `local-workflow-rag-retrieval.ts` 的 recommends 映射中移除 `...(chunk.provenance === undefined ? {} : { provenance: chunk.provenance })`。
5. **测试**：移除 contract test 中 `provenance` 相关的测试用例；移除 local governance test 中 `provenance` 断言；移除 projection test 和前端 projection test 中 `provenance` 字段（保留 `score` 作为非泄漏断言）。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | `Result shape is safe and bounded` | 移除未被消费的字段，简化 contract 和透传链路 | contract、schema、retriever、payload 不含 `provenance`；测试通过 |

### 与 active change 的关系

`refine-rag-retrieval-display` change 修改 `ts-run-status-visibility` spec，其中多处提到 "MUST NOT 包含 `provenance`"。本 change 只修改 `rag-tool` spec，不修改 `ts-run-status-visibility` spec。`refine-rag-retrieval-display` 归档时，其 spec delta 中的 `provenance` 引用变为 vacuously true（字段已不存在），可在基线刷新时清理。

### 远端兼容性

`ragRetrievalResultSchema` 使用 `additionalProperties: false`，移除 `provenance` 属性后，远端 RAG 服务如果仍返回 `provenance` 字段，schema 校验将失败。远端 RAG 服务需同步移除 `provenance`。

## 验证策略（Verification Strategy）

- **contract**：验证 `ragRetrievalResultSchema` 不再接受含 `provenance` 的响应。
- **unit**：验证本地 retriever 不再返回 `provenance`，`safeResultPayload` 不再透传 `provenance`。
- **projection**：验证投影层继续只输出 `{ source, content }`，`score` 仍不泄漏。

## 风险与取舍（Risks / Trade-offs）

- 远端 RAG 服务如果未同步移除 `provenance`，响应将被 schema 校验拒绝。这是预期行为——`additionalProperties: false` 的设计意图就是防止未定义字段。
- workflow `recommends` 中的 `provenance` 不受影响（开放 `JsonObject[]`），远端 workflow RAG 服务仍可返回 `provenance`。

## 待确认问题（Open Questions）

无。
