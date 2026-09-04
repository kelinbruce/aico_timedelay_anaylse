## 1. 节点 handler

- [x] 1.1 注册 `user-check`、`display-content`、`guardrail-check`、`delay-gateway`、`interrupt-gateway`、`sub-recipe` handler，标准节点名采用 `{}-{}`；兼容现存 `guardrail_check -> guardrail-check`
  验证：`npm run build`
  来源：design 决策 D1

- [x] 1.1A 明确 interaction node-specific schema owner：pending input、guardrail、display projection、sub-recipe mapping 等字段只在本 change 定义；不得要求 `agent-contracts/core` 为其冻结强类型
  验证：`npm run test:contract`
  来源：design 决策 D6

- [x] 1.1B 边界对齐：显式固化与 `package-composition`、`workflow-routing`、`execution-engine`、`gateway-nodes`、`knowledge-nodes`、`llm-nodes`、`capability-nodes` 的职责分工，避免在 interaction change 内重复承接 registry / dispatch / generic model / capability side effect owner
  验证：`npm run lint:architecture`
  来源：design boundary matrix

## 2. Pending input 与投影

- [x] 2.1 为 `user-check` 实现 pending input 创建、等待、回答恢复和超时路径
  验证：集成测试 I1、I2
  来源：spec requirement `User Check`

- [x] 2.2 为 `interrupt-gateway` 实现 external resume 等待语义，复用 runtime pending boundary
  验证：集成测试 I5
  来源：spec requirement `Interrupt Gateway`

- [x] 2.3 为 `display-content` 实现 safe text / markdown 投影
  验证：集成测试 I3
  来源：spec requirement `Display Content`

## 3. 其他交互节点

- [x] 3.1 为 `guardrail-check` 实现 policy hook 调用和 `pass` / `block` 输出，并兼容现存 `guardrail_check`
  验证：集成测试 I4
  来源：spec requirement `Guardrail Check`

- [x] 3.2 为 `delay-gateway` 实现时长等待与 cancel 响应
  验证：集成测试 I6
  来源：spec requirement `Delay Gateway`

- [x] 3.3 为 `sub-recipe` 实现 DSL `recipe_name`、显式 input / output mapping、嵌套深度限制
  验证：集成测试 I7
  来源：spec requirement `Sub Recipe`

## 4. 验证

- [x] 4.1 集成测试：`user-check` pause -> 用户回答 -> resume；超时走失败 / onError
  验证：`npm run test`
  来源：verification I1、I2

- [x] 4.2 集成测试：`display-content` 投影到客户端且不包含不安全内容
  验证：`npm run test`
  来源：verification I3

- [x] 4.3 集成测试：`guardrail-check` `block` 后阻断后续路径；现存 `guardrail_check` 也能被兼容解析
  验证：`npm run test`
  来源：verification I4

- [x] 4.4 集成测试：`interrupt-gateway` 等待外部 resume；`delay-gateway` 等待指定时长
  验证：`npm run test`
  来源：verification I5、I6

- [x] 4.5 集成测试：`sub-recipe` 嵌套 3 层完成；第 4 层超限失败；仅通过显式 mapping 传递变量
  验证：`npm run test`
  来源：verification I7

- [x] 4.6 Contract test：pending input owner 仍为 `agent-runtime`；`sub-recipe` DSL 继续使用 `recipe_name`
  验证：`npm run test:contract`
  来源：verification I8

- [x] 4.7 Architecture test：interaction 节点不在 `agent-workflow` 内自建 pending store / stream owner
  验证：`npm run lint:architecture`
  来源：design boundary

- [x] 4.8 Architecture test：interaction 节点不新增 recipe registry、主请求 dispatch path、candidate recipe selection 或 capability side effect path
  验证：`npm run lint:architecture`
  来源：design boundary matrix

- [x] 4.9 Architecture test：`sub-recipe` 只能通过 app-composed recipe definition source `require(agentId, recipe_name)` 解析目标 recipe，不得直接枚举或缓存 recipe
  验证：`npm run lint:architecture`
  来源：routing owner boundary

- [x] 4.11 `sub-recipe` 动态 `recipe_name` 诊断：变量模板解析失败时抛出 `WORKFLOW_NODE_INPUT_INVALID`，`safeDetails` 携带 `recipeNameTemplate`、`resolvedType`、`availableVariableKeys`
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts`（"reports diagnostic info when dynamic recipe_name resolves to undefined" PASS）
  来源：spec scenario `Dynamic Recipe Name Resolution Failure Reports Diagnostics`

- [x] 4.12 `sub-recipe` `recipe_result` 输出绑定：父节点 `outputs` 中 `${recipe_result}` 绑定子 recipe answer node 的 `nodeResult.output`（map 结构）；answer node 从 END 沿单前驱链反向取第一个非 gateway 节点（DSL"最后一个节点输出"）；fork/join 之前分支不影响 answer node；answer node 未定义或 output 缺失时回退空对象；中间节点输出通过 `outputMapping` 显式映射
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts`（answer node output 绑定、空对象回退、中间节点显式 mapping）
  来源：spec scenario `Recipe Result Binding Exposes Answer Node Output` + `Sub Recipe Answer Node Resolution`（含 Fork Join Does Not Change Answer Node）

- [x] 4.13 `sub-recipe` 事件转发：子 recipe 执行事件转发给父 observer，携带 `executionId` 和 `nodeId`，observer 按 `executionId` 查找 recipe 用于轨迹还原
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts`（"forwards observer to executeSubRecipe and registers recipe on observer" PASS）
  来源：spec scenario `Sub Recipe Events Forwarded To Parent Observer`
