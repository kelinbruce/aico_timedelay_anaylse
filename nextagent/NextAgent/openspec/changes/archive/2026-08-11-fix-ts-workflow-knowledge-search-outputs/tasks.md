## 1. 输出声明和 canonical binding

- [x] 1.1 在 knowledge-search 执行入口校验 `outputs` 为非空对象，且每个自定义 key 只精确映射 `${knowledge_search_result}` 或 `${recall_result}`；非法声明以 `WORKFLOW_NODE_INPUT_INVALID` 失败并确保 gateway 未被调用。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`
  来源：`Outputs Must Be Non-Empty and Canonical`

- [x] 1.2 将 `knowledgeSearchBindings` 收敛为仅返回 `knowledge_search_result` 和 `recall_result`：前者顺序投影字符串 `knowledge` 并忽略空字符串，后者保持原始 `recommends`；删除 knowledge-search 的 `documents`、`sourceDocuments`、`knowledge_diagnostic` binding。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts packages/agent-workflow/tests/workflow-rag-e2e.test.ts`
  来源：Knowledge Search 输出 contract

## 2. 行为、失败和非回归验证

- [x] 2.1 增加自定义 key 测试，覆盖只映射正文、只映射召回和同时映射两者，并断言未声明 binding 不进入节点输出。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`

- [x] 2.2 更新 knowledge-search 测试和直接相关 fixture，断言不存在 `documents`、`sourceDocuments`、`knowledge_diagnostic` 或其他 canonical binding。
  验证：`rg -n 'documents|sourceDocuments|knowledge_diagnostic' packages/agent-workflow/tests tests/contract`，并运行命中的直接相关测试

- [x] 2.3 覆盖混合空正文：空字符串被忽略，非空正文保持原值和顺序，`recall_result` 保持完整原始列表。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts packages/agent-workflow/tests/workflow-rag-e2e.test.ts`

- [x] 2.4 覆盖全部正文为空：正文 binding 为 `[]`，召回 binding 等于原始非空 `recommends`，workflow 正常继续。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`

- [x] 2.5 分别覆盖缺失 `knowledge` 和非字符串 `knowledge`，断言 `WORKFLOW_NODE_INPUT_INVALID`、当前正常路径中断且没有部分输出。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`

- [x] 2.6 运行 knowledge-qa、api-choice、recipe-choice 相关测试，确认其他节点输出不变。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts packages/agent-workflow/tests/workflow-rag-e2e.test.ts`

## 3. 一致性和门禁

- [ ] 3.1 运行 agent-workflow、contract 和 architecture 验证，确认唯一改动 owner 为 knowledge-search 私有声明/投影，未修改 gateway、adapter 或 frozen core contract。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts packages/agent-workflow/tests/workflow-rag-e2e.test.ts packages/agent-workflow/tests/workflow-rag-adapter.test.ts`、`npm run test:contract`、`npm run lint:architecture`
  当前证据：目标测试 40/40 通过；contract 在 `--maxWorkers=4` 下 289/289 通过；`npm run lint:architecture` 被未触达的 `packages/agent-workflow/src/runtime-node-adapters.ts` 既存 gateway subpath 违规阻塞。

- [x] 3.2 运行构建、OpenSpec 严格校验和 diff 文本门禁。
  验证：`npm run build`、`openspec validate --all --strict`、`git diff --check`

## 归档前更新基线检查（非实施任务）

- 归档前将完整 Knowledge Search requirement 合并到长期 capability spec。
- 不更新 usage 文档或历史残留文档。
- 不归档 `add-ts-workflow-rag-index-params`。
