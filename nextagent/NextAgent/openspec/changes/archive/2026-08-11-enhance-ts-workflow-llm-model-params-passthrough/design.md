# Design: Workflow model_params 经 modelParams 通道的不透明透传

## 背景和现状（Context）

`agent-workflow/src/nodes/shared.ts` 中的 `modelParamsInferenceOptions` 从 recipe 节点 `inputs.model_params` 提取模型参数。当前实现选择性提取 8 个已知的中性字段，并把它们转换为 canonical `ModelInferenceOptions` 字段。未知字段平铺进入 `providerOptions`。

本设计用不透明透传取代该方式：只提取 `enable_thinking`（转换为 `thinking.depth`），其余所有字段作为一个 `modelParams` object 透传。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 简化 `modelParamsInferenceOptions`，只剥离 `enable_thinking` 并把其余内容不透明透传。
- 为 `ModelInferenceOptions` 新增 `modelParams` 字段作为不透明透传通道。
- 当 `thinking.depth === "OFF"` 时，provider 注入 `enable_thinking: false` 和 `chat_template_kwargs: { enable_thinking: false }`。
- provider 把 `modelParams` 字段展开到 HTTP request body 顶层。

**非目标：**
- 不把 temperature、top_p 等提取到 canonical 字段。它们以原样在 `modelParams` 中透传。
- 不修改 `reference-remote-model-gateway.ts`。它按原样透传请求。
- 不创建单独的 `openrouter-provider.ts`。OpenRouter 使用 openai-compatible provider。

## 设计决策（Decisions）

### D1: 经 modelParams 的不透明透传

`modelParamsInferenceOptions` 只剥离 `enable_thinking` 并把它转换为 `thinking.depth`。其余所有字段（包括 temperature、top_p、max_tokens 等）作为一个不透明 object 放入 `modelParams`。

| model_params key | 目标 |
|---|---|
| `enable_thinking: true` | `thinking: { depth: "HIGH" }` |
| `enable_thinking: false` | `thinking: { depth: "OFF" }` |
| `enable_thinking` 缺失 | 无 `thinking` 配置 |
| 所有其他 key | `modelParams`（不透明 JsonObject） |

来源：recipe 作者需要一个简单、可预测的透传通道。

### D2: ModelInferenceOptions 中的 modelParams 字段

`ModelInferenceOptions` 新增 `modelParams?: JsonObject`。这是不透明透传通道，与 `providerOptions`（承载受治理的 provider 专用选项）分离。

`mergeModelInferenceOptions` 从 override 透传 `modelParams`（override 替换 base，与 temperature 等相同）。

来源：关注点分离——`providerOptions` 是受治理的，`modelParams` 是不透明的 recipe 级参数。

### D3: preconditions.ts 允许 modelParams

`requestFields` Set 新增 `'modelParams'`。`optionsValid()` 新增 `(request.modelParams === undefined || isJsonObject(request.modelParams))`。

来源：既有前置条件模式。

### D4: toProviderNativeThinking 的 OFF 处理

`toProviderNativeThinking("OFF")` 只返回 `{ enable_thinking: false }`。不发送 `reasoning_effort`，因为在某些 provider SDK 中 `reasoning` 字段会覆盖 `enable_thinking`。

`prepareInvocation` 直接传递 `request.thinking?.depth`（不做提前的 OFF->undefined 映射）。

来源：vLLM gateway 在 body 顶层读取 `enable_thinking`；`reasoning_effort` 与它冲突。

### D5: chat_template_kwargs 注入

当 `thinking.depth === "OFF"` 时，`transformRequestBody` 还向 body 注入 `chat_template_kwargs: { enable_thinking: false }`。之所以需要这样，是因为 OpenRouter SDK schema 会从 `providerOptions.openrouter` 过滤未知 key，而 vLLM gateway 只识别 `chat_template_kwargs`。

来源：vLLM gateway chat template 配置。

### D6: modelParams 展开

`transformRequestBody` 把 `request.modelParams` 字段展开到 body 顶层。这允许 recipe 作者传递任意模型参数（temperature、top_p、seed 等）而无需修改代码。

来源：不透明透传契约——provider 不解释 modelParams，只转发它。

### D7: 无远程 gateway 变更

`reference-remote-model-gateway.ts` 按原样透传整个 `ModelInvocationRequest`。远程 gateway service 负责 body 构造。无需变更。

来源：既有 gateway 架构。

## 验证映射（Verification Map）

| 约束 | Task | 验证 |
|---|---|---|
| 不透明透传（只剥离 enable_thinking） | 1.1 | UT：modelParams 包含所有非 enable_thinking 字段 |
| enable_thinking 三态 | 1.2 | UT：true->HIGH、false->OFF、缺失->undefined |
| 契约中的 modelParams 字段 | 2.1 | tsc -b 通过 |
| preconditions 中的 modelParams | 2.2 | UT：modelParams 通过校验 |
| OFF -> 仅 enable_thinking: false | 3.1 | UT：toProviderNativeThinking("OFF") 返回 { enable_thinking: false } |
| chat_template_kwargs 注入 | 3.2 | UT：OFF 时 body 包含 chat_template_kwargs |
| modelParams 展开 | 3.3 | UT：body 顶层包含 modelParams 字段 |
| thinking 为 undefined -> 不注入 | 3.4 | UT：body 不包含 reasoning 字段 |
| 回归：既有行为 | 4.1 | 既有测试通过 |
| Architecture lint | 4.2 | npm run lint:architecture 通过 |
