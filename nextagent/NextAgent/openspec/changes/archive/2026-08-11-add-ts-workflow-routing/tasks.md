## 1. Recipe Capability

- [x] 1.1 将 recipe 运行时能力建模为 workflow capability，并通过 capability catalog 做 Agent Scope 可用性解析
  验证：`npm run test`

- [x] 1.2 routing 仅接受 `kind="WORKFLOW"` 的目标能力，不保留 `RECIPE` capability kind 分支
  验证：`npm test`

## 2. Dispatch

- [x] 2.0 新增 trusted request-carried `routingConstraints.targetRecipe`
  验证：`npm run test:contract`、channel schema test、runtime carry test

- [x] 2.1 显式 `targetRecipe` 命中时分发到 workflow service
  验证：`npm run test`

- [x] 2.2 显式 `targetRecipe` 未命中时回退 conversation loop
  验证：`npm run test`

- [x] 2.3 当前不保留 intent match；未命中时默认回退 conversation loop
  验证：`npm run test`

## 3. 边界验证

- [x] 3.4 boot-recipe 自动进入逻辑不存在：routing 不检查 RecipeDefinition.type，未提供 targetRecipe 时回退 conversation loop
  验证：`npm run test`（routing policy test 验证无 boot-recipe 自动进入）

- [x] 3.1 dispatch 不引入 recipe durable store
  验证：code review

- [x] 3.2 dispatch 不引入 workflow event table
  验证：code review

- [x] 3.3 依赖边界测试
  验证：`npm run lint:architecture`
