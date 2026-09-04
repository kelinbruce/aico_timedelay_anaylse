## 1. 节点 handler

- [x] 1.1 注册 `knowledge-search`、`knowledge-qa`、`api-choice`、`recipe-choice` handler
  验证：`npm run build`
  来源：design 决策 D1

- [x] 1.1A 明确 knowledge node-specific schema owner：检索、候选选择、source refs 等字段只在本 change 定义；不得要求 `agent-contracts/core` 为其冻结强类型
  验证：`npm run test:contract`
  来源：design 决策 D6

- [x] 1.1B 边界对齐：显式固化与 `package-composition`、`workflow-routing`、`execution-engine`、`gateway-nodes`、`llm-nodes`、`interaction-nodes`、`capability-nodes` 的职责分工，避免在 knowledge change 内重复承接 dispatch / generic model / sub-recipe / restful owner
  验证：`npm run lint:architecture`
  来源：design boundary matrix

## 2. 检索与摘要

- [x] 2.1 实现标准 `rag_index` / `query` / topN 输入解析和知识 gateway 调用
  验证：集成测试 K1
  来源：spec requirement `Knowledge Search`

- [x] 2.2 实现检索结果排序、裁剪和 safe source ref 产出
  验证：集成测试 K2
  来源：spec requirement `Knowledge Search`

- [x] 2.3 实现 `knowledge-qa` 的“先检索后问答”组合节点语义
  验证：集成测试 K3
  来源：spec requirement `Knowledge QA`

## 3. 候选选择

- [x] 3.1 实现 `api-choice` 的 bounded candidate API 选择，并在 DSL 边界输出固定 `api_name`
  验证：集成测试 K4
  来源：spec requirement `API Choice`

- [x] 3.2 实现 `recipe-choice` 的 bounded candidate recipe 选择，保持 DSL 输出字段为 `recipe_name`
  验证：集成测试 K5
  来源：spec requirement `Recipe Choice`

## 4. 验证

- [x] 4.1 集成测试：`knowledge-search` 返回排序正确的文档列表
  验证：`npm run test`
  来源：verification K1

- [x] 4.2 集成测试：`knowledge-qa` 返回 answer 和 source refs
  验证：`npm run test`
  来源：verification K3

- [x] 4.3 集成测试：`api-choice` 只在候选集内选 API 并输出 Recipe 1.0 固定字段 `api_name`
  验证：`npm run test`
  来源：verification K4

- [x] 4.4 集成测试：`recipe-choice` 输出 DSL `recipe_name`，供 `sub-recipe` 消费
  验证：`npm run test`
  来源：verification K5

- [x] 4.5 Contract test：source refs 可追溯但不包含不必要全文；`recipe-choice` 保持 DSL `recipe_name`，无旧 `recipeId` 残留
  验证：`npm run test:contract`
  来源：verification K6

- [x] 4.6 Architecture test：knowledge handler 只通过知识 gateway / model service 调用外部依赖
  验证：`npm run lint:architecture`
  来源：design boundary

- [x] 4.7 Architecture test：`api-choice` / `recipe-choice` 只选择不执行；knowledge 节点不新增 dispatch、sub-recipe 执行或 restful side effect path
  验证：`npm run lint:architecture`
  来源：design boundary matrix

## 5. Recipe 1.0 DSL 输出修正

- [x] 5.1 将 `api-choice` 内部 `apiName` 在节点边界唯一映射为固定输出 `api_name`；RAG 路径仅额外发布 `recall_result`
  验证：`npm test -- --run packages/agent-workflow/tests/knowledge-nodes.test.ts`
  来源：spec scenario `API Name Field Preserved`

- [x] 5.2 增加 `${api_name}` 到下游 `restful.inputs.api_name` 的业务链路测试，并断言 `${apiName}` 在模型或 gateway 调用前失败
  验证：`npm test`
  来源：spec scenario `Camel Case Output Rejected`

- [x] 5.3 允许 RAG `api-choice` recipe 只声明固定输出 `api_name`，并仅在显式声明时投影可选的 `recall_result`
  验证：`npm test -- --run packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`
  来源：spec scenario `RAG API Name Without Recall Result`
