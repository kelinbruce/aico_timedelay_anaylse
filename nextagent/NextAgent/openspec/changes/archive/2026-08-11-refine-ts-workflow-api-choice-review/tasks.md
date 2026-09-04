# Tasks

## 1. 模型配置去重（shared.ts + 调用方）

- [x] 1.1 在 `shared.ts` 新增 `resolveNodeModelConfig(context, options, inputs)` 函数，封装"读 model/modelGroup → resolveModelForParamExtract override → fallback resolveModelInvocationConfig"逻辑
  验证：单元测试覆盖 model override、modelGroup override、fallback 三条路径
  来源：design D1

- [x] 1.2 将 `knowledge-nodes.ts` 的 `resolveApiChoiceModelConfig` 改为调用 `resolveNodeModelConfig`，保留 model_params 合并逻辑在调用方
  验证：api-choice 测试全部通过（D6 model_params 透传、D6 model override）
  来源：design D1

- [x] 1.3 将 `restful-param-extract.ts` 的 `resolveParamExtractModelConfig` 改为调用 `resolveNodeModelConfig`
  验证：restful param-extract 测试全部通过
  来源：design D1

## 2. modelGroup deferred 明确

- [x] 2.1 在 `runtime-adapters.ts` 中将 `_modelGroup` 改为 `modelGroup`，添加注释说明 deferred 原因
  验证：代码检视确认注释清晰
  来源：design D2

- [x] 2.2 在 `types.ts` 的 `resolveModelForParamExtract` JSDoc 中明确 modelGroup 为 deferred
  验证：代码检视确认 JSDoc 更新
  来源：design D2

- [x] 2.3 添加测试断言：modelGroup 有值但 model 为空时，当前行为是 fallback 到全局配置（不报错、不生效）
  验证：单元测试覆盖此边界
  来源：design D2

## 3. asNonNegativeInteger 去重

- [x] 3.1 在 `shared.ts` 新增 `asNonNegativeInteger` 函数（使用 coerceNumber 版本）
  验证：单元测试覆盖 number、string、invalid 输入
  来源：design D3

- [x] 3.2 将 `capability-nodes.ts` 中的私有 `asNonNegativeInteger` 改为 import shared 版本
  验证：capability-nodes 测试全部通过
  来源：design D3

- [x] 3.3 将 `engine/index.ts` 中的私有 `asNonNegativeInteger` 改为 import shared 版本
  验证：engine 测试全部通过
  来源：design D3

## 4. whitespace damage 修复

- [x] 4.1 恢复 `capability-nodes.ts` 中 `executePythonNode` 的 `const trace = nodeTrace(...)` 缩进为 2-space
  验证：git diff 确认无 whitespace 变更
  来源：design D4

- [x] 4.2 恢复 `capability-nodes.ts` 中 `executeAgentNode` 的 `const trace = nodeTrace(...)` 缩进为 2-space
  验证：git diff 确认无 whitespace 变更
  来源：design D4

## 5. 验证

- [x] 5.1 Regression test：api-choice 全部测试通过（D1-D9 覆盖）
  验证：`vitest run packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`
  来源：验证入口

- [x] 5.2 Regression test：restful 全部测试通过（retry、param extract、time param、reflection）
  验证：`vitest run packages/agent-workflow/tests/workflow-capability-nodes.test.ts`
  来源：验证入口

- [x] 5.3 Architecture test：`npm run lint:architecture` 通过
  验证：depcruiser + architecture tests
  来源：验证入口

- [x] 5.4 Code review：`$nextagent-code-review` 检视通过
  验证：检视结论 PASS 或 PASS WITH FOLLOW-UP
  来源：AGENTS.md push gate