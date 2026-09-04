# 模型 Provider 边界

## 目标与范围

模型子系统以稳定的 `modelId` 为唯一对外模型标识，隔离开发者配置、模型选择、provider SDK、凭据、远程网关和运行期调用。该边界同时保证 Agent Scope 固化、模型能力查询、推理调用、生命周期 hook、失败降级与可观测投影使用同一份模型事实。

## 责任边界

| Owner | 职责 | 禁止事项 |
|---|---|---|
| `agent-app` | 校验并冻结二级 system config；校验 Agent assembly 的 `modelIds/defaultModelId`；装配 credential resolver、provider ports、可选 `FetchGateway` 和 lifecycle hook port，并把这些可信依赖交给模型 runtime factory | 不构造 provider registration 或 SDK client，不实现 catalog、推理、模型选择或 fallback |
| `agent-model` | 构造模型目录与推理服务；解析 provider binding；隔离 SDK；执行 hook、retry、timeout、stream/tool normalization、输出完整性证据分类和 safe error mapping | 不读取 Agent 定义，不决定 fallback 或输出恢复顺序，不依赖 gateway implementation package |
| `agent-context-engine` | 基于 assembly 和模型目录执行初选/降级选择；按实际选中模型的上下文窗口整形 prompt | 不调用 provider SDK，不拥有跨模型重试生命周期 |
| `agent-core` | 驱动一次或多轮推理、工具调用、输出恢复和跨模型 fallback；为 run-bound 调用生成 timeline step 事实 | 不解析模型配置，不自行判断 provider-native stream terminal 或重新推断输出完整性 |
| gateway | 通过可选通用 `FetchGateway` 隔离运行环境 fetch；通过 `ModelGatewayProvider` 提供平台模型信息与推理实现 | 不拥有模型选择、Agent Scope 或 prompt shaping |
| observability / workbench | 仅投影安全的模型 ID、可用性、默认模型和运行证据 | 不读取 credential、raw provider error、prompt 或模型输出 |

Provider runtime capability 是启动装配事实。默认 composition 注入 OpenAI-compatible provider registration；`model-gateway-only` composition 不注入它，并通过专属 TypeScript project 把 OpenAI-compatible invocation implementation 和仅其使用的 normalizer 从编译输入中排除。配置的 provider 缺少对应 registration，或 `model-gateway-only` 配置了 `openai-compatible` profile 时，必须在模型目录发布前 fail closed。

## 配置与目录

`DefaultSystemConfig.modelProfiles` 使用二级结构：父项以稳定 `providerId` 标识 `openai-compatible` 或 `model-gateway` provider，并承载 provider 访问配置；子项以全局唯一 `modelId` 标识模型并承载推理默认值。`NextAgentApp` 只暴露冻结后的 `systemConfig`，不再暴露平行的 model registry、provider kind 或单独 model input。

`ModelCatalogQueryService` 是唯一模型查询边界，提供 `list()` 和 `get(modelId)`。OpenAI-compatible 模型在启动期由静态配置确定上下文窗口；model-gateway 模型在首次查询或调用时按需获取信息。目录必须满足：

- app ready 与 Agent assembly publication 不触发 model-gateway 元数据 I/O；
- 每个 `modelId` 的首次远程解析 single-flight，结果校验后冻结并复用；
- 调用方取消只取消等待，不把 transient cancellation 冻结为全局 unavailable；
- 缺失、歧义或非法上下文窗口以 typed unavailable entry 呈现，不泄漏 raw gateway failure；
- catalog、选择服务与推理服务共享同一模型配置事实，不维护第二套 configured model membership。

## 推理调用

`ToolChoice = 'AUTO' | 'NONE' | 'REQUIRED'` 是 provider-neutral 的唯一 Tool 选择词汇，并由 `ModelInferenceOptions.toolChoice` 贯穿 profile、resolved configuration 与 invocation request。缺省为 `AUTO`；Prompt Template、Capability request-local patch、trusted request model options 和 `BEFORE_MODEL_INVOKE` Hook 只能按既定优先级覆盖同一字段，不能通过 `providerOptions` 或 `modelParams` 建立平行 authority。selected provider adapter 负责把三值映射到原生请求；首版不接受 named-tool choice object。

`toolChoice=NONE` 不删除 Tool descriptors。`executionMode=model-only` 从首次调用开始强制 effective `NONE`；Agent finalizing turn 同样强制 `NONE`。任何 provider 违规返回的 Tool call 必须保留为模型结果证据但零执行。`REQUIRED` 与空 Tool descriptor 集合在 provider 调用前安全失败。

对外只有 `ModelInvocationService`：`complete(...)` 返回 `Promise<ModelFinalResult>`；`stream(...)` 通过 callback 投递规范化 delta，并仍以 `Promise<ModelFinalResult>` 返回唯一终态。调用方不再自行从最后一个 delta 猜测终态。

`ModelFinalResult` 同时保留 provider-neutral `finishReason` 和 optional `incompleteOutputReason`，后者只允许 `output-limit | truncated-tool-call`，字段缺失表示没有可恢复的不完整输出证据。两者是独立事实：adapter 不得为触发恢复把 `tool-calls`、`stop` 或 `unknown` 改写为 `length`。统一终态 normalization 为没有结构残缺 Tool call 的 `length` 标记 `output-limit`；结构残缺 Tool call 只有在 `length`，或 `tool-calls | stop | unknown` 且合法 `usage.outputTokens >= effective maxOutputTokens` 时标记 `truncated-tool-call`。没有完整 Tool call 的 `finishReason="tool-calls"` 只有携带精确 `truncated-tool-call` 证据才可进入恢复，字段缺失或为 `output-limit` 等不匹配值时收敛为 non-retryable `MODEL_TOOL_CALLS_MISSING`。usage 缺失、非法或未饱和继续返回普通安全校验失败；`content-filter`、`error` 和已有 `safeError` 优先收敛且不得携带不完整原因。流式与非流式路径在 hook 和调用方消费前执行同一 closed-schema 校验，残缺 Tool arguments 不得离开 adapter。

`ModelInvocationRequest` 只接受 `modelId`、provider-neutral messages/tools、扁平 `ModelInferenceOptions` 和 `ModelInvocationScope`。scope 必须包含 `tenantId/subjectId/agentId/agentVersion/agentAssemblyRef/operationId`；run 坐标必须全有或全无。provider binding 在 `agent-model` 内按 `modelId` 精确解析，外部不得传入 provider kind、base URL、credential ref 或 provider-native client。

providerOptions 是开发者扩展点：允许未知 JSON 字段并做防御性复制，但不得重复或覆盖 `modelId`、messages、tools、timeout、retry、thinking 等框架权威字段。profile、Prompt Template、受治理 Skill patch、可信 request 与受治理 hook 之间执行顶层浅合并；后层同名字段覆盖前层，同名嵌套对象整体替换，不递归合并。

OpenAI-compatible 路径使用 AI SDK Chat Completions provider。默认同模型重试次数为 2、总墙钟超时为 300 秒（内置 `default-system.yaml` 默认模型 profile 显式 `300000 ms`）；SDK 负责 initial request、retry 与 backoff 的总时限。流式调用一旦向上游交付 delta，不得再自动重试。所有 provider exception、terminal 缺失、content filter 与取消必须归一化为安全终态或框架控制信号，raw provider payload 不得越过边界。

## Header 与运行环境 fetch

模型 adapter 只确定四个框架 header：始终发送 `X-NextAgent-Agent-Id`，存在完整 run scope 时再发送 `X-NextAgent-Session-Id`、`X-NextAgent-Request-Id`、`X-NextAgent-Run-Id`。这些 header 来自可信 scope，不接受调用方覆盖，也不需要通用 header policy。

`FetchGateway` 定义在 gateway contract 中，名称与语义保持通用而不绑定模型用途。local 模式可不装配；remote composition 可选装配并由 `agent-app` 适配为 provider fetch。额外 header、认证和非模型 REST 行为不属于本边界。

## 模型选择与失败降级

Context Engine 直接消费 `AgentAssembly.modelIds/defaultModelId` 与 `ModelCatalogQueryService`。初选顺序为显式 modelId、Agent 默认模型、首个 eligible 模型；fallback 从当前模型之后选择下一 eligible 模型。Agent 未显式配置模型时，assembly compiler 使用系统模型清单并选择首项为默认值，builtin 与开发者 Agent 遵循同一规则。

Core 拥有跨模型调用生命周期：可恢复失败才进入 fallback，选择新模型后必须按该模型上下文窗口重新 assemble/render；不可恢复错误、取消和 lifecycle interruption 立即结束。tool calls 以非空内容为事实，不依赖 provider 是否准确返回 `finishReason="tool-calls"`。

Core 只依据已校验的 `incompleteOutputReason` 进入唯一有界输出恢复流程，不再直接依据 `finishReason`。两类原因均先尝试一次同请求预算提升：提升后的 `output-limit` 若 content 为空、无 Tool call 且 reasoning 非空，先执行至多一次 request-local reasoning-only 收敛重试，再进入最多 3 次 request-local 续写；`truncated-tool-call` 提升后仍有任一不完整原因时立即安全失败，不进入文本续写。恢复成功只消费重新生成的完整回答或完整 Tool call；首次及恢复阶段的残缺 Tool call 均零执行。恢复复用同一模型路由、消息、Tool 集合、provider-neutral options、timeout 和 cancellation signal，只覆盖 `maxOutputTokens`；correction 与中间恢复消息不持久化，也不建立 provider/model 名称分支、容差配置或第二恢复 owner。

## Lifecycle、timeline 与可观测性

`agent-model` 在每次实际 provider 调用前后执行 `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT`，因此 run-bound agent loop、summary、memory、recommendation 等所有模型调用都遵循同一 hook 语义。hook 可读取当前 messages，但 diagnostics、audit、metric 和 timeline 不得记录 raw prompt 或模型输出。

run-bound 调用由 core 的窄 wrapper 为每次模型尝试记录精确 `stepId/modelId` 的 `MODEL_INVOCATION_STARTED`，以及唯一 `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED`；非 run-bound 调用执行 hook 但不伪造 run timeline。开发工作台从 assembly 读取精确 `modelIds/defaultModelId` 并结合 timeline 展示，不从事件集合猜测默认模型。metric 使用有界标签，不使用 `modelId`、provider kind、prompt 或输出作为标签。

## 安全、失败与延期边界

- credential 只通过 resolver 在 provider boundary 内解析；配置、safe error、日志、timeline 和 workbench 不得包含 secret。
- raw provider request/response/error、prompt、模型输出、路径和 stack 不得越过安全边界。
- 不引入通用 header policy、第二套 provider dispatcher、test-only product injection 或 no-op provider。
- system instruction 仍通过 provider-neutral message 表达；独立 system prompt 字段不属于本稳定契约。

## 验证

- system config、Agent model reference、reserved providerOptions、scope/header 与 credential redaction contract tests；
- catalog lazy resolution、single-flight、cancellation、availability 与 assembly publication tests；
- provider registration 注入、gateway-only 编译图排除与配置能力不匹配 fail-closed tests；
- complete/stream、retry/timeout、terminal/tool-use normalization、输出完整性 decision table、残缺 Tool call 零执行、hook 与 fallback characterization tests；
- workbench default model projection、metrics bounded-label、migration tool 与 architecture tests；
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。

## 关联规格

- `model-invocation-contract`
- `model-provider-adapter`
- `model-stream-normalization`
- `model-fallback-semantics`
- `context-engine`
- `lifecycle-hook-execution`
- `agent-package-assembly`
- `gateway-configuration`
- `prompt-template-assembly`
- `dev-agent-workbench`

## Capability 失败处置协作

`ToolChoice` 的 profile/Prompt/Capability patch/trusted request/Hook precedence、`REQUIRED + tools=[]` 前置失败、provider-native mapping/collision 和 finalizing hard constraint 统一见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。Model adapter 只映射最终 effective value，不能读取 Capability error 决定重试，也不能通过 provider-specific option 扩大 Tool 权限。
