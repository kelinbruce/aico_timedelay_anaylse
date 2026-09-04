## 1. `FN-5.13 检索知识库`

- [ ] 1.1 修改 `rag-tool` spec delta，移除 `Result shape is safe and bounded` Requirement 中的 `provenance` 引用，移除 `RAG 检索具有低基数执行诊断` Requirement 诊断 "MUST NOT" 列表中的 `provenance` 引用。
  来源：`FN-5.13` + 可维护性 + `Result shape is safe and bounded`
  验证：`openspec validate --all --strict`。

- [ ] 1.2 从 `RagRetrievalChunk` 接口移除 `provenance?: string`，从 `ragRetrievalResultSchema` 移除 `provenance` 属性。
  来源：`FN-5.13` + gateway contract
  验证：`npm run build`；contract test 中含 `provenance` 的响应校验失败。

- [ ] 1.3 从 `ragOutputSchema` 移除 `provenance` 属性，从 `safeResultPayload` 移除 `provenance` 透传。
  来源：`FN-5.13` + capability contract
  验证：`npm run build`。

- [ ] 1.4 从本地 retriever 移除 `provenance` 生成，从 `local-workflow-rag-retrieval` adapter 移除 `provenance` 映射。
  来源：`FN-5.13` + gateway local
  验证：local governance test 不再断言 `provenance`。

- [ ] 1.5 更新测试：移除 contract test、local governance test、projection test 和前端 projection test 中的 `provenance` 引用。
  来源：`FN-5.13` + 测试
  验证：`npm test`；`frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts`。

## 2. Change 整体验证

- [ ] 2.1 运行 `openspec validate --all --strict`、`npm run build`、`npm test`。
  来源：proposal 影响范围 + design 验证策略
  验证：所有门禁通过。

- [ ] 2.2 使用 `$nextagent-code-review` 做语义检视。
  来源：design 修改方案
  验证：检视结论为 `PASS` 或 `PASS WITH FOLLOW-UP`。

## 归档前更新基线检查（非实施任务）

归档时同步 `openspec/specs/rag-tool/spec.md`、`openspec/designs/architecture/rag-tool.md` 中的 `provenance` 引用。
