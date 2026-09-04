# Tasks

## 1. YAML 解析接口替换

- [ ] 1.1 引入 `js-yaml` 运行时依赖到 `agent-app`
  验证：`npm install` 成功；`packages/agent-app/package.json` 含 `js-yaml`
  来源：design「解析器替换」

- [ ] 1.2 替换 `parseBuiltInConfig` 实现：JSON 优先，非 JSON 回退到 `js-yaml` 的 `load`；接口签名不变（入参 `content: string`，出参 `unknown`）
  验证：`npm run build`
  来源：design「解析器替换」；spec requirement `Recipe YAML Parsing`

- [ ] 1.3 移除 `parseFlatYaml` 函数及其 `Built-in YAML uses unsupported syntax.` 错误路径
  验证：`rg -n "parseFlatYaml" packages/agent-app/src` 无结果；`npm run build`
  来源：design「解析器替换」；spec scenario `Flat YAML Parser Removed`

## 2. 解析接口能力测试

- [ ] 2.1 新增 `workflow-recipe-yaml-parsing.test.ts`：断言 `parseBuiltInConfig`（已从 `testing.ts` 导出）解析嵌套 map、块式数组、字符串、数字、布尔、null 及混合结构
  验证：`vitest run packages/agent-app/tests/workflow-recipe-yaml-parsing.test.ts`
  来源：design「解析器替换」；spec scenario `Nested Structure Parsing`、`Scalar Type Inference`、`Standard YAML Parsing`

- [ ] 2.2 断言 JSON 内容仍走 `JSON.parse` 且返回值与 JSON 结构一致
  验证：`vitest run packages/agent-app/tests/workflow-recipe-yaml-parsing.test.ts`
  来源：spec scenario `JSON Fallback Preserved`

- [ ] 2.3 断言非法 YAML 抛异常且不静默返回空值或默认值
  验证：`vitest run packages/agent-app/tests/workflow-recipe-yaml-parsing.test.ts`
  来源：spec scenario `Parse Failure Propagation`

- [ ] 2.4 断言接口为纯函数：无 I/O、无日志、无状态变更
  验证：`vitest run packages/agent-app/tests/workflow-recipe-yaml-parsing.test.ts`
  来源：spec scenario `Pure Function No Side Effects`

## 3. 回归测试

- [ ] 3.1 运行 `system-config.test.ts` 验证 `default-system.yaml`（JSON 语法）加载不回归
  验证：`vitest run packages/agent-app/tests/system-config.test.ts`
  来源：design「影响面分析」

- [ ] 3.2 agent 定义加载回归：现有 `agent.yaml`（JSON 语法）经 `parseBuiltInConfig` + `parseAgentDefinition` 加载不回归
  验证：`vitest run packages/agent-app/tests`（agent 定义相关测试）
  来源：design「影响面分析」

## 4. 全量验证

- [ ] 4.1 `npm run build`
  验证：构建成功
  来源：验证入口

- [ ] 4.2 `npm run lint:architecture`
  验证：`agent-app` 对 `js-yaml` 依赖不破坏架构边界
  来源：design「边界对齐」

- [ ] 4.3 `openspec validate --all --strict`
  验证：OpenSpec 校验通过
  来源：验证入口
