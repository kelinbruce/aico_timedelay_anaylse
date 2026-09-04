# Proposal: Workflow model_params 经 modelParams 通道的不透明透传

## 背景与问题（Background and Why）

Recipe 节点可以配置 `model_params`（一个不透明 JSON object）来向模型调用传递参数。当前 `modelParamsInferenceOptions` 实现选择性提取已知的中性字段（temperature、max_tokens、top_p 等），并把它们转换为 canonical `ModelInferenceOptions` 字段。该方式存在问题：

1. 每个新的模型参数都要求修改 `modelParamsInferenceOptions` 中的代码才能被识别。
2. `enable_thinking: false` 与缺失无法区分——provider 无法判断 recipe 作者是否显式关闭了 thinking。
3. 未知字段被平铺放进 `providerOptions`，这与 provider 的保留名守卫冲突，也丢失了「provider 专用选项」和「要透传的模型参数」之间的语义区分。

## 变更范围（What Changes）

- **简化** `modelParamsInferenceOptions`：
  - 剥离 `enable_thinking`（boolean）并转换为 `thinking.depth`：`true` -> `"HIGH"`、`false` -> `"OFF"`、缺失 -> `undefined`。
  - 把其余所有字段（包括 temperature、top_p 等）作为一个不透明 object 放入 `modelParams`。
  - 当 `model_params` 缺失或不是 object 时返回 `undefined`。

- 在 `agent-contracts/model` 的 `ModelInferenceOptions` 接口和 schema 中**新增** `modelParams?: JsonObject`。

- **更新** `mergeModelInferenceOptions` 以透传 `modelParams`（override 替换 base）。

- **更新** `preconditions.ts` 以允许 `modelParams` 通过校验。

- **更新** openai-compatible provider：
  - `toProviderNativeThinking("OFF")` 只返回 `{ enable_thinking: false }`（不含 `reasoning_effort`）。
  - 当 `thinking.depth === "OFF"` 时，`transformRequestBody` 注入 `chat_template_kwargs: { enable_thinking: false }`（面向 vLLM gateway）。
  - `transformRequestBody` 把 `request.modelParams` 字段展开到 HTTP request body 顶层。

- `reference-remote-model-gateway.ts` **无变更**。它按原样透传整个 `ModelInvocationRequest`；远程 gateway service 负责 body 构造。

## Capability 影响（Capabilities）

### 修改的 Capability

- `workflow-llm-nodes`：把 `modelParamsInferenceOptions` 简化为不透明透传。
- `model-invocation-contract`：新增 `modelParams` 字段并澄清 `thinking.depth === "OFF"` 的 provider 处理。

### 新增 Capability

无。

## 影响范围（Impact）

- `agent-contracts`：`model/index.ts`（`ModelInferenceOptions` 接口 + schema）。
- `agent-workflow`：`shared.ts`（`modelParamsInferenceOptions`、`mergeModelInferenceOptions`）。
- `agent-model`：`preconditions.ts`、`openai-compatible-provider.ts`。
- 对 `agent-app`、`agent-channel-web` 或前端无影响。

## 职责边界对齐（Boundary Alignment）

- 与 `model-invocation-contract`：`providerOptions` 仍是受治理 provider 专用选项的通道。`modelParams` 是新的不透明通道，用于绕过 canonical 字段提取的 recipe 级模型参数。
- 与 `enhance-ts-workflow-output-parser-display-control`：无重叠。

## 验证（Validation）

- 单元测试：`modelParamsInferenceOptions` 剥离 enable_thinking，其余字段作为 modelParams 透传。
- 单元测试：`toProviderNativeThinking("OFF")` 返回 `{ enable_thinking: false }` 而不含 `reasoning_effort`。
- 单元测试：`transformRequestBody` 在 OFF 时注入 `chat_template_kwargs` 并展开 modelParams。
- 单元测试：thinking 为 undefined 时不注入 reasoning 字段。
- `tsc -b`、`npm run lint:architecture`、完整测试套件。
