# Tasks

## 1. 简化 modelParamsInferenceOptions

- [x] 1.1 只从 model_params 剥离 enable_thinking，转换为 thinking.depth（true->HIGH、false->OFF）。其余所有字段作为 modelParams 透传。
  验证：UT 断言 modelParams 包含所有非 enable_thinking 字段；enable_thinking 转换正确
  来源：design D1

## 2. 把 modelParams 加入契约和前置条件

- [x] 2.1 为 ModelInferenceOptions 接口和 schema 新增 modelParams?: JsonObject。
  验证：tsc -b 通过
  来源：design D2

- [x] 2.2 在 preconditions.ts 的 requestFields Set 和 optionsValid() 中新增 modelParams。
  验证：UT 断言 modelParams 通过校验
  来源：design D3

- [x] 2.3 更新 mergeModelInferenceOptions 以从 override 透传 modelParams。
  验证：UT 断言 override modelParams 替换 base
  来源：design D2

## 3. 更新 openai-compatible provider

- [x] 3.1 把 toProviderNativeThinking("OFF") 改为只返回 { enable_thinking: false }（移除 reasoning_effort）。
  验证：UT 断言 OFF -> { enable_thinking: false }；无 reasoning_effort
  来源：design D4

- [x] 3.2 当 thinking.depth === "OFF" 时，在 transformRequestBody 中注入 chat_template_kwargs: { enable_thinking: false }。
  验证：UT 断言 OFF 时 body 包含 chat_template_kwargs
  来源：design D5

- [x] 3.3 在 transformRequestBody 中把 request.modelParams 字段展开到 body 顶层。
  验证：UT 断言 modelParams 字段出现在 body 中
  来源：design D6

- [x] 3.4 把 request.thinking?.depth 直接传递给 toProviderNativeThinking（移除 OFF->undefined 提前映射）。
  验证：既有 provider 测试通过；OFF 到达 toProviderNativeThinking
  来源：design D4

## 4. 回归与验证

- [x] 4.1 既有 model_params 行为（enable_thinking=true）保持不变。
  验证：既有 agent-workflow 测试通过
  来源：design 非目标

- [x] 4.2 TypeScript 构建通过且无新错误。
  验证：`tsc -b`
  来源：AGENTS.md 验证门禁

- [x] 4.3 Architecture lint 通过。
  验证：`npm run lint:architecture`
  来源：AGENTS.md 验证门禁

- [x] 4.4 完整的 agent-workflow 和 agent-model 测试套件通过。
  验证：`vitest run packages/agent-workflow/tests/ packages/agent-model/tests/`
  来源：AGENTS.md 验证门禁
