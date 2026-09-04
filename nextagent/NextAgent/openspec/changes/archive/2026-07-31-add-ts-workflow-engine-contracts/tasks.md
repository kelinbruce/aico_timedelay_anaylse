## 1. agent-common vocabulary

- [x] 1.1 新增 `WorkflowNodeType`
  验证：`npm run build`

## 2. agent-contracts/core 最小 workflow contract

- [x] 2.1 新增 `RecipeDefinition`、`FlowGraph`、`WorkflowNodeDef`、`WorkflowBranchDef`
  验证：`npm run build`

- [x] 2.2 新增 `WorkflowExecutionService`、`WorkflowExecutionRequest`、`WorkflowExecutionResult`、`WorkflowNodeResult`
  验证：`npm run build`

- [x] 2.3 新增 `WorkflowExecutionEvent`
  验证：`npm run build`

- [x] 2.5 为 `WorkflowExecutionService.execute()` 增加可选 `WorkflowExecutionObserver`，并为 `WorkflowExecutionEvent` 增加安全可见 delta contract
  验证：`npm run build`

- [x] 2.4 为 `AgentAssembly` 新增 `recipeIds?: string[]`
  验证：`npm run build`

## 3. 契约测试

- [x] 3.1 `RecipeDefinition` / `FlowGraph` schema 校验测试
  验证：`npm run test:contract`

- [x] 3.2 `WorkflowExecutionService.execute()` 异步签名测试
  验证：`npm run test:contract`

- [x] 3.3 `WorkflowExecutionEvent` 安全字段约束测试
  验证：`npm run test:contract`

- [x] 3.5 `WorkflowExecutionObserver` / `visibleDelta` 契约测试
  验证：`npm run test:contract`

- [x] 3.4 `AgentAssembly.recipeIds` 可选字段测试
  验证：`npm run test:contract`

## 4. 收尾

- [x] 4.1 运行验证
  验证：`npm run build && npm run test:contract`

## 5. Workflow capability kind 修正

- [x] 5.1 将 durable `CapabilityKind` 与 runtime schema 统一为 `TOOL | SKILL | AGENT | WORKFLOW`，删除 `RECIPE` kind
  验证：`npm run test:contract`

- [x] 5.2 增加 `WORKFLOW` 接受与 `RECIPE` 拒绝的 contract negative test
  验证：`npm run test:contract`

- [x] 5.3 刷新 P3 roadmap，消除“recipe 不进入 capability catalog”与现行业务链路的冲突
  验证：`$nextagent-skill-review`
