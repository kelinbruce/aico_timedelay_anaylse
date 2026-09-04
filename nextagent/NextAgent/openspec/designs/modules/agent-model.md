# agent-model

## 职责

承载完整的模型领域运行时：模型目录、provider registration 与 binding、推理服务、生命周期 hook、AI SDK adapter、stream/tool-use normalization、输出完整性证据分类、retry/timeout、cancellation 和 safe error mapping。

## 非职责

不拥有 Agent assembly 编译、模型选择顺序、跨模型 fallback、prompt assembly、runtime lifecycle 或 gateway adapter 实现；不把 provider SDK、raw credential、raw provider request/response/error 暴露给其他 package。

## 依赖

允许依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts/model`、`@nextagent/agent-contracts/runtime` 和 `@nextagent/agent-contracts/agent-assembly` public subpath。Provider SDK 只留在本 package；可选环境 fetch 以函数形式从 composition 注入，不依赖 `agent-contracts/gateway` 或 gateway implementation package。

## 核心设计落点

- Provider runtime capability 显式注入。OpenAI-compatible 的 provider-specific public export 只暴露 registration，不 import SDK；invocation implementation 作为运行期可选插件动态加载。`tsconfig.model-gateway-only.json` 把 OpenAI-compatible invocation implementation 和仅其使用的 normalizer 排除出编译输入，默认 project 继续编译两者。
- selected provider adapter 把 canonical `ToolChoice` 三值映射为原生请求；`providerOptions` 和 `modelParams` 中与 `toolChoice` 规范化同名的 key 必须拒绝，其他扩展字段保持 owning contract 语义。
- `toolChoice=NONE` 时仍接收完整 Tool descriptors；provider 违规返回 Tool call 不由 model 包执行。`REQUIRED` 与空 tools 在 provider dispatch 前安全失败。

- `createConfiguredModelRuntime(...)` 是模型运行时 factory，接收冻结的 provider profiles、credential resolver、可选 fetch、model-gateway providers、assembly registry 和 lifecycle hook port，返回 `catalog` 与 `invocationService` 两个公开服务。
- `ModelCatalogQueryService.list/get` 是唯一模型查询接口；OpenAI-compatible 配置立即可用，model-gateway 信息按模型 lazy resolution、per-model single-flight 和 validated freeze 处理。
- `ModelInvocationService.complete/stream` 只接收 `modelId` 与可信 invocation scope；内部精确解析 provider binding、合并推理选项、执行 assembly authorization 和 lifecycle hook，再调用对应 provider registration。
- `stream` 通过 callback 交付 canonical delta，并以 Promise 返回唯一 `ModelFinalResult`；terminal 检测、tool call 聚合和 provider stream close 只在本 package 处理。
- `ModelFinalResult.finishReason` 与 optional `incompleteOutputReason` 是独立 provider-neutral 事实；后者只允许 `output-limit | truncated-tool-call`。统一 normalization 为明确 `length` 建立 `output-limit`，OpenAI-compatible adapter 仅在结构残缺 Tool call 同时具有 `length` 或“非 length 且合法 output usage 达到本次有效输出预算”证据时建立 `truncated-tool-call`。adapter 保留原 finish reason、content、合法 usage 和 response id，但不交付残缺 Tool call；usage 缺失、非法或未饱和保持普通安全失败，不估算、不设容差、不按 provider/model 名称分支。
- `content-filter`、`error` 和已有 `safeError` 优先于不完整输出分类，失败终态不得携带 `incompleteOutputReason`。没有完整 Tool call 的 `finishReason="tool-calls"` 只有在 `incompleteOutputReason="truncated-tool-call"` 时可穿过统一 terminal normalization；字段缺失或为 `output-limit` 等其他值时返回 non-retryable `MODEL_TOOL_CALLS_MISSING`。complete/stream、hook 前终态和直接 consumer 复用同一 closed schema；本包只建立事实，不拥有预算提升、correction、续写、Tool 执行或跨模型 fallback。
- AI SDK Chat Completions adapter 负责同模型 retry、总墙钟 timeout、abort 传播、thinking mapping、tool-use normalization 和 safe error mapping；首个 delta 交付后禁止重试。
- providerOptions 保留未知 JSON 扩展字段，拒绝覆盖框架权威字段；profile 与调用级 options 采用统一合并语义。
- `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT` 对 run-bound 与非 run-bound 调用均生效；control interruption 原样传播给 runtime lifecycle boundary。统一模型生命周期 wrapper 在完成 before hook 后、调用 concrete provider 前读取单调时钟，成功 terminal result 返回后计算非负整数毫秒 `modelE2ELatencyMs`；`stream` 在首次非空 content/reasoning/tool call delta 到达时冻结 `firstContentLatencyMs`，`complete` 在成功 terminal result 中按首个非空 content、非空 reasoning或至少一个 tool call 判定首次反馈；无上述反馈时省略该字段。成功 `ModelFinalResult.usage` 存在时 wrapper 原样投影其已提供的 `inputTokens`、`outputTokens` 和 `totalTokens`，未提供字段保持缺失；未携带 usage 时省略。模型调用失败时不合成 `AFTER_MODEL_RESULT` boundary。这些诊断字段是 observe-only boundary facts，不参与 `AFTER_MODEL_RESULT` mutation。
- enabled hook 可在内存中读取并替换 messages；未修改内容使用 structural sharing/copy-on-write，任何观测边界都不得输出 raw messages。
- deterministic/injected provider 只通过 testing surface 使用，不进入 product composition。

## 替换边界

是。Model provider adapter 与完整 model runtime 可通过 public contract 和 composition registration 替换。

## 验证关注点

- catalog 与 invocation 共享同一 provider/model binding，不存在第二套 membership 或 provider-kind dispatcher；
- model-gateway lazy resolution、single-flight、cancellation 与 unavailable freeze 行为；
- assembly authorization、hook、retry/timeout、stream terminal、输出完整性 decision table、tool-use 和 safe error 一致性；
- 残缺 Tool arguments 不离开 adapter，usage 缺失/非法/未饱和不触发恢复，流式与非流式终态使用同一 closed schema；
- provider-native type、credential、prompt、输出、raw error 和 SDK client 不越过 package boundary；
- test provider 不泄漏到生产 composition。

## Capability 失败处置协作

本包只拥有 provider-neutral 模型调用校验以及 `ToolChoice=AUTO|NONE|REQUIRED` 到 provider-native 字段的唯一映射。它必须拒绝 `providerOptions`/`modelParams` 中的 Tool-choice collision，并在 `REQUIRED` 但无可见 Tool 时于 provider 调用前失败；它不拥有 Agent budget、Capability retry 或 Tool 执行。precedence 与 finalizing hard guard 见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-model`
