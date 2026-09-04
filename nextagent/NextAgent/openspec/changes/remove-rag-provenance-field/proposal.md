## Why

`RagRetrievalChunk` 的 `provenance` 字段在整个展示链路中从未被消费：投影层 `projectRagRetrievalSafeResult` 只输出 `{ source, content }`，前端只读取 `source` 和 `content`，`provenance` 在展示层不可见。该字段在本地 retriever 中被生成、在 `safeResultPayload` 中被透传、在 workflow adapter 中被映射，但最终在投影层被丢弃。移除该字段可简化 gateway contract、减少不必要的字段透传和测试负担。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 从 `RagRetrievalChunk` gateway contract 接口和 `ragRetrievalResultSchema` 中移除 `provenance` 字段。
- 从 RAG 工具输出 schema (`ragOutputSchema`) 中移除 `provenance` 字段。
- 从 `safeResultPayload` 和 `local-workflow-rag-retrieval` adapter 中移除 `provenance` 透传。
- 从本地 retriever 中移除 `provenance` 生成逻辑。
- 更新所有涉及 `provenance` 的测试。

**非目标：**

- 不修改 `ts-run-status-visibility` spec 中对 `provenance` 的 "MUST NOT" 引用（由 `refine-rag-retrieval-display` change 归档时清理）。
- 不改变 `source`、`title`、`score`、`rankHint` 等其他字段的行为。
- 不改变 RAG 工具的输入、执行、失败映射或可观测性语义。
- 不改变 workflow RAG `recommends` 的开放 `JsonObject[]` 形状（远端 workflow RAG 服务仍可返回 `provenance`，由 workflow adapter 透传）。

## What Changes

- `rag-tool` spec 中 `Result shape is safe and bounded` Requirement：移除 result items 中的 `provenance` 字段引用。
- `rag-tool` spec 中 `RAG 检索具有低基数执行诊断` Requirement：移诊断 "MUST NOT" 列表中的 `provenance` 引用。
- `agent-contracts/gateway`：从 `RagRetrievalChunk` 接口移除 `provenance` 字段，从 `ragRetrievalResultSchema` 移除 `provenance` 属性。
- `agent-capability/builtins/rag`：从 `ragOutputSchema` 移除 `provenance` 属性，从 `safeResultPayload` 移除 `provenance` 透传。
- `agent-platform-gateway-local`：从本地 retriever 移除 `provenance` 生成，从 `local-workflow-rag-retrieval` adapter 移除 `provenance` 映射。
- 测试：移除 contract test、local governance test、projection test 和前端 projection test 中的 `provenance` 引用。

## Feature 影响（Features）

无。本变更不改变用户可见行为。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-5.13 检索知识库` → `specs/rag-tool/spec.md`
  - 功能边界：移除 gateway contract 中未被消费的 `provenance` 字段；不改变检索执行、安全映射或结果数量边界。
  - 系统质量属性：可维护性。
  - 映射说明：`rag-tool` 是 canonical spec。

## 影响范围（Impact）

- 远端 RAG 服务如果仍在响应中返回 `provenance` 字段，`ragRetrievalResultSchema` 的 `additionalProperties: false` 约束将拒绝该响应。远端 RAG 服务需同步移除 `provenance`。
- 本地 retriever 不再生成 `provenance`，不影响展示链路。
- workflow adapter 不再从 `RagRetrievalChunk` 映射 `provenance`，但远端 workflow RAG 服务的 `recommends` 仍可包含 `provenance`（开放 `JsonObject[]` 不受影响）。
